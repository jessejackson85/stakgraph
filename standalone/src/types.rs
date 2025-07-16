use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Serialize, Deserialize)]
pub struct ProcessBody {
    pub repo_url: Option<String>,
    pub repo_path: Option<String>,
    pub username: Option<String>,
    pub pat: Option<String>,
    pub use_lsp: Option<bool>,
    pub commit: Option<String>,
}
#[derive(Serialize, Deserialize)]
pub struct ProcessResponse {
    pub nodes: u32,
    pub edges: u32,
}
#[derive(Serialize, Deserialize)]
pub struct FetchRepoBody {
    pub repo_name: String,
}
#[derive(Serialize, Deserialize)]
pub struct FetchRepoResponse {
    pub status: String,
    pub repo_name: String,
    pub hash: String,
}

#[derive(Debug)]
pub enum AppError {
    Anyhow(anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::Anyhow(err) => {
                tracing::error!("Handler error: {:?}", err);
                (StatusCode::BAD_REQUEST, err.to_string()).into_response()
            }
        }
    }
}

impl<E> From<E> for AppError
where
    E: Into<anyhow::Error>,
{
    fn from(err: E) -> Self {
        Self::Anyhow(err.into())
    }
}
