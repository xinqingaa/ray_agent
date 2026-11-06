//! 拉起随包分发的冻结核心：经 stdin 私有管道传入启动参数，从 stdout 读取握手端口并做健康检查；
//! 退出时只回收本宿主创建的核心进程组。
use std::collections::VecDeque;
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

#[derive(Clone, Default, Serialize)]
pub struct CoreStatus {
    state: String,
    port: Option<u16>,
    pid: Option<u32>,
    startup_ms: Option<u128>,
    build: Option<Value>,
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
    status: Arc<Mutex<CoreStatus>>,
    logs: Arc<Mutex<VecDeque<String>>>,
    process: Mutex<Option<Running>>,
}

impl CoreHost {
    pub fn status(&self) -> CoreStatus {
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
        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("probe-core");
        // 开发阶段的连接与模型配置文件，P2 由设置页与钥匙串取代。
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
        let launch = json!({ "data_dir": data_dir, "env_files": env_files });
        let written = writeln!(stdin, "{launch}").and_then(|_| stdin.flush());
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
            let handshake = lines
                .next()
                .and_then(Result::ok)
                .and_then(|line| serde_json::from_str::<Value>(&line).ok());
            match handshake {
                Some(message) if message["event"] == "ready" => {
                    let port = message["port"].as_u64().and_then(|port| u16::try_from(port).ok());
                    let elapsed = started.elapsed().as_millis();
                    eprintln!("[host] core ready on 127.0.0.1:{} after {elapsed} ms", port.unwrap_or(0));
                    let health = port.map(check_health);
                    let mut status = status.lock().unwrap();
                    status.state = "ready".into();
                    status.port = port;
                    status.startup_ms = Some(elapsed);
                    status.build = Some(message["build"].clone());
                    status.health = health;
                }
                other => {
                    let reason = other
                        .and_then(|message| message["reason"].as_str().map(str::to_owned))
                        .unwrap_or_else(|| "核心未完成握手即退出".into());
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
