//! 拉起 Python 核心：经 stdin 私有管道传入启动参数，从 stdout 读取握手、核对协议并做健康检查；
//! 退出时只回收本宿主创建的核心进程组。启动参数与握手的结构见 contract 模块。
//!
//! 正式包运行随包分发的冻结核心；开发构建直接运行源码核心（api/.venv 中的解释器加 sidecar.py），
//! 不必每次重新冻结。两者都不依赖工作目录。
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
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::contract::{CoreHandshake, CoreLaunch, CoreReady, ErrorInfo};

/// 宿主支持的核心协议与事件版本；与生成的契约样例不一致时对齐检查失败。
pub const PROTOCOL_VERSION: u32 = 4;
pub const EVENT_VERSION: u32 = 1;

const CORE_DIR: &str = "rayagent-core";
const LOG_LINES: usize = 200;
const FAILURE_LOG_LINES: usize = 40;
// 核心收到 stdin 关闭后最多用 20 秒收尾再自退，宿主多等一段再发信号。
const EXIT_GRACE: Duration = Duration::from_secs(25);
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

#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CoreState {
    #[default]
    Starting,
    Ready,
    Failed,
    Incompatible,
    Exited,
    Stopped,
}

/// 界面读取的核心连接。ready 时给出接口地址与实例令牌；失败时给出原因与最近的核心日志。
#[derive(Clone, Default, Serialize)]
pub struct CoreConnection {
    state: CoreState,
    pid: Option<u32>,
    startup_ms: Option<u128>,
    base_url: Option<String>,
    token: Option<String>,
    ready: Option<CoreReady>,
    health: Option<Value>,
    error: Option<ErrorInfo>,
    detail: Option<String>,
    logs: Vec<String>,
}

struct Running {
    child: Child,
    stdin: Option<ChildStdin>,
    /// 宿主密钥只存在于宿主进程内存；登记所选文件夹的请求带它，界面拿不到。
    host_secret: String,
}

/// 32 字节系统随机数的十六进制串，每次启动核心重新生成。
fn generate_host_secret() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("无法生成宿主密钥：{e}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[derive(Default)]
pub struct CoreHost {
    connection: Arc<Mutex<CoreConnection>>,
    logs: Arc<Mutex<VecDeque<String>>>,
    process: Mutex<Option<Running>>,
    generation: Arc<Mutex<u64>>,
}

impl CoreHost {
    pub fn connection(&self) -> CoreConnection {
        let mut connection = self.connection.lock().unwrap().clone();
        if matches!(connection.state, CoreState::Failed | CoreState::Exited | CoreState::Incompatible) {
            let logs = self.logs.lock().unwrap();
            connection.logs = logs.iter().skip(logs.len().saturating_sub(FAILURE_LOG_LINES)).cloned().collect();
        }
        connection.ready.iter_mut().for_each(|ready| ready.instance_token.clear());
        connection
    }

    /// 已就绪核心的端口与令牌，供宿主代为下载。
    pub fn endpoint(&self) -> Option<(u16, String)> {
        let connection = self.connection.lock().unwrap();
        match (&connection.state, &connection.ready) {
            (CoreState::Ready, Some(ready)) => Some((ready.port, ready.instance_token.clone())),
            _ => None,
        }
    }

    pub fn is_ready(&self) -> bool {
        self.connection.lock().unwrap().state == CoreState::Ready
    }

    pub fn start(&self, app: &AppHandle) {
        if let Err(detail) = self.spawn(app) {
            let mut connection = self.connection.lock().unwrap();
            connection.state = CoreState::Failed;
            connection.detail = Some(detail);
        }
    }

    /// 失败或退出后重新拉起；先回收旧进程，不同时运行两个核心。
    pub fn restart(&self, app: &AppHandle) {
        self.stop();
        self.logs.lock().unwrap().clear();
        self.start(app);
    }

    fn command(app: &AppHandle) -> Result<Command, String> {
        if cfg!(debug_assertions) {
            let api = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../api"));
            let python = api.join(".venv/bin/python");
            if !python.exists() {
                return Err(format!("开发构建运行源码核心，缺少 {}；在 ray_agent/api 执行 uv sync --locked", python.display()));
            }
            let mut command = Command::new(python);
            command.arg(api.join("sidecar.py"));
            return Ok(command);
        }
        let executable = app.path().resource_dir().map_err(|e| e.to_string())?.join(CORE_DIR).join(CORE_DIR);
        Ok(Command::new(executable))
    }

    fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
        // RAYAGENT_CORE_DATA_DIR 可换用独立数据根，避免与同机其他宿主共用一个实例锁。
        if let Some(dir) = std::env::var_os("RAYAGENT_CORE_DATA_DIR") {
            return Ok(PathBuf::from(dir));
        }
        let name = if cfg!(debug_assertions) { "dev-core" } else { "core" };
        Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(name))
    }

    fn spawn(&self, app: &AppHandle) -> Result<(), String> {
        let generation = {
            let mut generation = self.generation.lock().unwrap();
            *generation += 1;
            *generation
        };
        *self.connection.lock().unwrap() = CoreConnection::default();
        let data_dir = Self::data_dir(app)?;
        let mut command = Self::command(app)?;
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).process_group(0);
        for name in SCRUBBED_ENV {
            command.env_remove(name);
        }
        let started = Instant::now();
        let mut child = command.spawn().map_err(|e| format!("无法启动核心：{e}"))?;
        let mut stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        self.connection.lock().unwrap().pid = Some(child.id());
        let host_secret = generate_host_secret()?;
        let launch = CoreLaunch { data_dir, env: BTreeMap::new(), host_secret: host_secret.clone() };
        let written = serde_json::to_string(&launch)
            .map_err(std::io::Error::other)
            .and_then(|line| writeln!(stdin, "{line}"))
            .and_then(|_| stdin.flush());
        *self.process.lock().unwrap() = Some(Running { child, stdin: Some(stdin), host_secret });
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

        let connection = self.connection.clone();
        let current = self.generation.clone();
        thread::spawn(move || {
            let update = |change: &dyn Fn(&mut CoreConnection)| {
                if *current.lock().unwrap() == generation {
                    change(&mut connection.lock().unwrap());
                }
            };
            let mut lines = BufReader::new(stdout).lines();
            let handshake = lines.next().and_then(Result::ok).map(|line| serde_json::from_str::<CoreHandshake>(&line));
            match handshake {
                Some(Ok(CoreHandshake::Ready(ready))) => {
                    let elapsed = started.elapsed().as_millis();
                    eprintln!(
                        "[host] core ready on 127.0.0.1:{} after {elapsed} ms (protocol {}, instance {})",
                        ready.port, ready.protocol_version, ready.instance.instance_id
                    );
                    let compatible = ready.protocol_version == PROTOCOL_VERSION && ready.event_version == EVENT_VERSION;
                    let health = compatible.then(|| check_health(ready.port, &ready.instance_token));
                    update(&|connection| {
                        connection.startup_ms = Some(elapsed);
                        connection.health = health.clone();
                        if compatible {
                            connection.state = CoreState::Ready;
                            connection.base_url = Some(format!("http://127.0.0.1:{}/api", ready.port));
                            connection.token = Some(ready.instance_token.clone());
                        } else {
                            connection.state = CoreState::Incompatible;
                            connection.detail = Some(format!(
                                "核心协议 {}／事件 {} 与本程序支持的 {PROTOCOL_VERSION}／{EVENT_VERSION} 不一致",
                                ready.protocol_version, ready.event_version
                            ));
                        }
                        connection.ready = Some(ready.clone());
                    });
                }
                other => {
                    update(&|connection| {
                        connection.state = CoreState::Failed;
                        match &other {
                            Some(Ok(CoreHandshake::Failed(failed))) => connection.error = Some(failed.error.clone()),
                            Some(Err(error)) => connection.detail = Some(format!("握手不符合核心契约：{error}")),
                            _ => connection.detail = Some("核心未完成握手即退出".into()),
                        }
                    });
                }
            }
            for _ in lines {}
            update(&|connection| {
                if connection.state == CoreState::Ready {
                    connection.state = CoreState::Exited;
                    connection.base_url = None;
                    connection.token = None;
                    connection.detail = Some("核心进程意外退出".into());
                }
            });
        });
        Ok(())
    }

    /// 当前核心的宿主密钥；供宿主调用 `POST /api/host/folder-grants` 时附带，不得传给界面。
    pub fn host_secret(&self) -> Option<String> {
        self.process.lock().unwrap().as_ref().map(|running| running.host_secret.clone())
    }

    /// 关闭 stdin 让核心正常停止：核心停止受理、结束活动运行后退出。超时后发送 SIGTERM，最后结束组内残留进程再回收首进程。
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
        *self.generation.lock().unwrap() += 1;
        let mut connection = self.connection.lock().unwrap();
        connection.state = CoreState::Stopped;
        connection.base_url = None;
        connection.token = None;
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

fn check_health(port: u16, token: &str) -> Value {
    match http_get(port, "/api/status", token) {
        Ok((code, body)) => serde_json::json!({
            "http_status": code,
            "body": serde_json::from_str::<Value>(&body).unwrap_or(Value::String(body)),
        }),
        Err(error) => serde_json::json!({ "error": error.to_string() }),
    }
}

fn http_get(port: u16, path: &str, token: &str) -> std::io::Result<(u16, String)> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, HEALTH_TIMEOUT)?;
    stream.set_read_timeout(Some(HEALTH_TIMEOUT))?;
    stream.set_write_timeout(Some(HEALTH_TIMEOUT))?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    )?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    let code = response.split(' ').nth(1).and_then(|code| code.parse().ok()).unwrap_or(0);
    let body = response.split_once("\r\n\r\n").map(|(_, body)| body.to_owned()).unwrap_or_default();
    Ok((code, body))
}
