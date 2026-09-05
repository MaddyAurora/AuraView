use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// Check if a local port is currently open and reachable
#[tauri::command]
fn check_port_active(port: u16) -> bool {
    let address: Result<SocketAddr, _> = format!("127.0.0.1:{}", port).parse();
    if let Ok(addr) = address {
        TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
    } else {
        false
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![check_port_active])
        .run(tauri::generate_context!())
        .expect("error while running AuraView application");
}
