use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(ws_handler));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await.unwrap();
    println!("Server jalan di http://localhost:3001");
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    let hands = song_core::deal_random();
    let json = serde_json::to_string(&hands[0]).unwrap();
    if socket.send(Message::Text(json)).await.is_err() {
        return;
    }

    while let Some(Ok(msg)) = socket.recv().await {
        if let Message::Text(text) = msg {
            if socket.send(Message::Text(format!("echo: {text}"))).await.is_err() {
                break;
            }
        }
    }
}