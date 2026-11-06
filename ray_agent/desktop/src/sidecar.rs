//! 拉起随包分发的冻结核心：经 stdin 私有管道传入启动参数，从 stdout 读取握手并做健康检查；
//! 退出时只回收本宿主创建的核心进程组。启动参数与握手的结构见 contract 模块。
use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::contract::{CoreHandshake, CoreLaunch, CoreReady};

const CORE_DIR: &str = "rayagent-core";
const LOG_LINES: usize = 200;
const EXIT_GRACE: Duration = Duration::from_secs(15);
const TERM_GRACE: Duration = Duration::from_secs(3);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
// 会改变冻结解释器或动态库查找的宿主环境变量不传给核心。
const SCRUBBED_ENV: &[&str] = &[
    "PYTHONHOME",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "PYTHONSAFEPATH",
    "VIRTUAL_ENV",
    "DYLD_LIBRARY_PATH",
    "DYLD_FALLBACK_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
];

/// 宿主对核心进程的观察，供页面读取；ready 为核心的握手内容。
#[derive(Clone, Default, Serialize)]
pub struct HostStatus {
    state: String,
    pid: Option<u32>,
    startup_ms: Option<u128>,
    ready: Option<CoreReady>,
    health: Option<Value>,
    detail: Option<String>,
    logs: Vec<String>,
}

struct Running {
    child: Child,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
pub struct CoreHost {
    status: Arc<Mutex<HostStatus>>,
    logs: Arc<Mutex<VecDeque<String>>>,
    process: Mutex<Option<Running>>,
}

impl CoreHost {
    pub fn status(&self) -> HostStatus {
        let mut status = self.status.lock().unwrap().clone();
        status.logs = self.logs.lock().unwrap().iter().cloned().collect();
        status
    }

    pub fn start(&self, app: &AppHandle) {
        if let Err(detail) = self.spawn(app) {
            let mut status = self.status.lock().unwrap();
            status.state = "failed".into();
            status.detail = Some(detail);
        }
    }

    fn spawn(&self, app: &AppHandle) -> Result<(), String> {
        let core_dir = app.path().resource_dir().map_err(|e| e.to_string())?.join(CORE_DIR);
        let executable = core_dir.join(CORE_DIR);
        // 开发检查可用 RAYAGENT_CORE_DATA_DIR 换用独立数据根，避免与同机其他宿主共用一个实例锁。
        let data_dir = match std::env::var_os("RAYAGENT_CORE_DATA_DIR") {
            Some(dir) => PathBuf::from(dir),
            None => app.path().app_data_dir().map_err(|e| e.to_string())?.join("probe-core"),
        };
        // 开发阶段的模型配置文件，P2 由设置页与钥匙串取代。
        let env_files: Vec<PathBuf> = std::env::var_os("RAYAGENT_CORE_ENV")
            .map(|paths| std::env::split_paths(&paths).collect())
            .unwrap_or_default();

        let mut command = Command::new(&executable);
        command
            .current_dir(&core_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0);
        for name in SCRUBBED_ENV {
            command.env_remove(name);
        }
        let started = Instant::now();
        let mut child = command
            .spawn()
            .map_err(|e| format!("无法启动核心 {}：{e}", executable.display()))?;
        let mut stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        {
            let mut status = self.status.lock().unwrap();
            status.state = "starting".into();
            status.pid = Some(child.id());
        }
        let launch = CoreLaunch { data_dir, env_files, env: BTreeMap::new() };
        let written = serde_json::to_string(&launch)
            .map_err(std::io::Error::other)
            .and_then(|line| writeln!(stdin, "{line}"))
            .and_then(|_| stdin.flush());
        *self.process.lock().unwrap() = Some(Running { child, stdin: Some(stdin) });
        if let Err(error) = written {
            self.stop();
            return Err(format!("无法写入启动参数：{error}"));
        }

        let logs = self.logs.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("[core] {line}");
                let mut logs = logs.lock().unwrap();
                if logs.len() == LOG_LINES {
                    logs.pop_front();
                }
                logs.push_back(line);
            }
        });

        let status = self.status.clone();
        thread::spawn(move || {
            let mut lines = BufReader::new(stdout).lines();
            let handshake = lines.next().and_then(Result::ok).map(|line| serde_json::from_str::<CoreHandshake>(&line));
            match handshake {
                Some(Ok(CoreHandshake::Ready(ready))) => {
                    let elapsed = started.elapsed().as_millis();
                    eprintln!(
                        "[host] core ready on 127.0.0.1:{} after {elapsed} ms (protocol {}, instance {})",
                        ready.port, ready.protocol_version, ready.instance.instance_id
                    );
                    let health = check_health(ready.port);
                    let mut status = status.lock().unwrap();
                    status.state = "ready".into();
                    status.startup_ms = Some(elapsed);
                    status.ready = Some(ready);
                    status.health = Some(health);
                }
                other => {
                    let reason = match other {
                        Some(Ok(CoreHandshake::Failed(failed))) => failed.error.message,
                        Some(Err(error)) => format!("握手不符合核心契约：{error}"),
                        _ => "核心未完成握手即退出".into(),
                    };
                    let mut status = status.lock().unwrap();
                    status.state = "failed".into();
                    status.detail = Some(reason);
                }
            }
            for _ in lines {}
            let mut status = status.lock().unwrap();
            if status.state == "ready" {
                status.state = "exited".into();
                status.detail = Some("核心进程已退出".into());
            }
        });
        Ok(())
    }

    /// 关闭 stdin 让核心正常停止；超时后发送 SIGTERM，最后结束组内残留进程再回收首进程。
    pub fn stop(&self) {
        let Some(mut running) = self.process.lock().unwrap().take() else {
            return;
        };
        let pid = running.child.id() as libc::pid_t;
        drop(running.stdin.take());
        if !wait_exit(pid, EXIT_GRACE) {
            unsafe { libc::kill(pid, libc::SIGTERM) };
            wait_exit(pid, TERM_GRACE);
        }
        // 首进程尚未被回收，组号不会被系统复用，信号只会到达本宿主创建的进程组。
        unsafe { libc::killpg(pid, libc::SIGKILL) };
        let _ = running.child.wait();
        eprintln!("[host] core process group {pid} stopped");
        self.status.lock().unwrap().state = "stopped".into();
    }
}

/// 只观察退出而不回收（WNOWAIT），保证 killpg 之前首进程仍占用组号。
fn wait_exit(pid: libc::pid_t, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        let flags = libc::WEXITED | libc::WNOHANG | libc::WNOWAIT;
        let result = unsafe { libc::waitid(libc::P_PID, pid as libc::id_t, &mut info, flags) };
        if result != 0 || info.si_pid == pid {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn check_health(port: u16) -> Value {
    match http_get(port, "/api/status") {
        Ok((code, body)) => json!({
            "http_status": code,
            "body": serde_json::from_str::<Value>(&body).unwrap_or(Value::String(body)),
        }),
        Err(error) => json!({ "error": error.to_string() }),
    }
}

fn http_get(port: u16, path: &str) -> std::io::Result<(u16, String)> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, HEALTH_TIMEOUT)?;
    stream.set_read_timeout(Some(HEALTH_TIMEOUT))?;
    stream.set_write_timeout(Some(HEALTH_TIMEOUT))?;
    write!(stream, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    let code = response.split(' ').nth(1).and_then(|code| code.parse().ok()).unwrap_or(0);
    let body = response.split_once("\r\n\r\n").map(|(_, body)| body.to_owned()).unwrap_or_default();
    Ok((code, body))
}
