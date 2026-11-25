//! API keys for the Tokens page.
//!
//! One token table and no scopes (locked scope): every key is a
//! full-permission bearer credential. Plaintext is shown exactly once at
//! mint time; only the SHA-256 hash is stored. A key minted by a signed-in
//! account records that account as its maker; the maker's name outlives the
//! account.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::{Extension, Json};
use serde_json::{Value, json};

use crate::AppState;
use crate::api::ApiError;
use crate::auth::{Authed, OP_TOKEN_PREFIX, hash_token, mint_op_token};
use crate::metrics::metric_time;

#[derive(sqlx::FromRow)]
struct TokenRow {
    id: i64,
    name: String,
    created_at: String,
    expires: Option<String>,
    active: i64,
    last_used_at: Option<String>,
    maker_user_id: Option<i64>,
    /// The maker's current name, or the name kept after their removal.
    maker_name: Option<String>,
}

/// Every key column plus the maker, current name first.
const SELECT_KEYS: &str = "SELECT t.id, t.name, t.created_at, t.expires, t.active, t.last_used_at,
        t.maker_user_id, COALESCE(u.name, t.maker_name) AS maker_name
 FROM tokens t LEFT JOIN users u ON u.id = t.maker_user_id";

/// Scopes the panel may show. The Rust backend has one scope: full.
const SCOPES: [&str; 1] = ["full"];

fn api_key_json(row: &TokenRow) -> Value {
    let expired = row
        .expires
        .as_deref()
        .and_then(metric_time)
        .is_some_and(|at| at < chrono::Utc::now().timestamp_millis());
    let status = if expired {
        "expired"
    } else if row.active == 0 {
        "inactive"
    } else {
        "active"
    };
    // `removed`: the account that made it is gone; its name is kept.
    let maker = row.maker_name.as_ref().map(|name| {
        json!({
            "id": row.maker_user_id,
            "name": name,
            "removed": row.maker_user_id.is_none(),
        })
    });

    json!({
        "id": row.id,
        "name": row.name,
        "userID": "",
        "createdDate": row.created_at,
        "active": row.active != 0,
        "expires": row.expires,
        "lastUsedAt": row.last_used_at,
        "status": status,
        "scopes": SCOPES,
        "maker": maker,
    })
}

async fn fetch_key(pool: &sqlx::SqlitePool, id: i64) -> Result<TokenRow, ApiError> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!("{SELECT_KEYS} WHERE t.id = ?")))
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(internal)
}

/// GET /api/v1/api-keys
pub async fn list(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let rows: Vec<TokenRow> =
        sqlx::query_as(sqlx::AssertSqlSafe(format!("{SELECT_KEYS} ORDER BY t.id")))
            .fetch_all(&state.pool)
            .await
            .map_err(internal)?;

    Ok(Json(json!({
        "ok": true,
        "count": rows.len(),
        "apiKeys": rows.iter().map(api_key_json).collect::<Vec<_>>(),
        "availableScopes": SCOPES,
        "tokenKind": "operator",
        "tokenPrefix": OP_TOKEN_PREFIX,
        "note": "This list contains operator tokens only. Agent credentials are shown on their monitor (push) or backup-agent registration (backup).",
    })))
}

/// POST /api/v1/api-keys
pub async fn create(
    State(state): State<AppState>,
    Extension(authed): Extension<Authed>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let payload = body
        .as_object()
        .ok_or_else(|| ApiError::bad("body must be a JSON object"))?;

    let name = payload
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| ApiError::bad("`name` is required."))?
        .chars()
        .take(255)
        .collect::<String>();
    let active = payload
        .get("active")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let expires = parse_expires(payload)?;

    let (maker_id, maker_name) = crate::accounts::maker(&state.pool, &authed.principal)
        .await?
        .unzip();
    let token = mint_op_token();
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO tokens (name, hash, scheme, active, expires, maker_user_id, maker_name)
         VALUES (?, ?, 'sha256', ?, ?, ?, ?)
         RETURNING id",
    )
    .bind(&name)
    .bind(hash_token(&token))
    .bind(if active { 1 } else { 0 })
    .bind(&expires)
    .bind(maker_id)
    .bind(&maker_name)
    .fetch_one(&state.pool)
    .await
    .map_err(internal)?;
    let row = fetch_key(&state.pool, id).await?;

    state.events.invalidate();
    tracing::info!("api-keys: minted key {} ({name})", row.id);

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "ok": true,
            "apiKey": api_key_json(&row),
            // Shown once. There is no endpoint that returns this again.
            "token": token,
            "tokenKind": "operator",
            "tokenPrefix": OP_TOKEN_PREFIX,
            "usage": {
                "api": "Authorization: Bearer kmon_op_...",
                "web": "It cannot sign in to the web app. People sign in with Kore ID.",
            },
            "warning": "This token can manage the whole instance. Do not give it to a host agent: agents use kmon_agent_push_... minted with their monitor.",
        })),
    ))
}

/// PATCH /api/v1/api-keys/{id}
pub async fn patch(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let Some(active) = body.get("active").and_then(Value::as_bool) else {
        return Err(ApiError::bad("`active` (true/false) is required."));
    };

    let result = sqlx::query("UPDATE tokens SET active = ? WHERE id = ?")
        .bind(if active { 1 } else { 0 })
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(internal)?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found(format!("No API key with id {id}.")));
    }

    let row = fetch_key(&state.pool, id).await?;

    state.events.invalidate();

    Ok(Json(json!({
        "ok": true,
        "apiKey": api_key_json(&row),
    })))
}

/// DELETE /api/v1/api-keys/{id}
pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    let result = sqlx::query("DELETE FROM tokens WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(internal)?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found(format!("No API key with id {id}.")));
    }

    state.events.invalidate();
    tracing::info!("api-keys: revoked key {id}");

    Ok(Json(json!({ "ok": true, "deleted": id })))
}

fn internal(error: sqlx::Error) -> ApiError {
    tracing::error!("api-keys api: {error}");
    ApiError::server()
}

/// The optional `expires` of a new key: absent or empty means never. A value
/// that is not a date is refused, because a key the server cannot read the
/// expiry of must not end up valid forever.
fn parse_expires(payload: &serde_json::Map<String, Value>) -> Result<Option<String>, ApiError> {
    match payload
        .get("expires")
        .and_then(Value::as_str)
        .map(str::trim)
    {
        None | Some("") => Ok(None),
        Some(text) if metric_time(text).is_some() => Ok(Some(text.to_string())),
        Some(_) => Err(ApiError::bad(
            "`expires` must be a date and time, e.g. 2027-01-01T00:00:00Z.",
        )),
    }
}

#[cfg(test)]
mod expiry_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_unreadable_expiry_is_refused_on_create() {
        assert!(parse_expires(json!({"expires": "next tuesday"}).as_object().unwrap()).is_err());
        assert_eq!(parse_expires(json!({}).as_object().unwrap()).unwrap(), None);
        assert_eq!(
            parse_expires(json!({"expires": ""}).as_object().unwrap()).unwrap(),
            None
        );
        assert_eq!(
            parse_expires(
                json!({"expires": "2027-01-01T00:00:00Z"})
                    .as_object()
                    .unwrap()
            )
            .unwrap()
            .as_deref(),
            Some("2027-01-01T00:00:00Z")
        );
    }
}
