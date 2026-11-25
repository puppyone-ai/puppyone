//! The latest managed model call's reservation (`x-puppyone-reservation-id`),
//! noted by the model client that streamed it for its account, so that the
//! account's compute wallet reads that call's usage receipt after its next
//! refresh (`lastReservationId`).
use super::model::Binding;
use std::sync::Mutex;

static NOTED: Mutex<Option<(String, String, String)>> = Mutex::new(None);

/// What identifies an account's wallet: the account, its sign-in and its
/// environment.
pub fn key(binding: &Binding) -> String {
    format!(
        "{}\n{}\n{}",
        binding.user,
        binding.epoch,
        binding.environment.api()
    )
}

/// A reservation id as the service sends one: a lowercase UUID.
pub fn valid(value: &str) -> bool {
    value.len() == 36
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f' | b'-'))
}

/// `binding`'s call to `model` streams under `reservation` (ignored unless
/// it is a valid id).
pub fn note(binding: &Binding, reservation: &str, model: &str) {
    if valid(reservation)
        && let Ok(mut noted) = NOTED.lock()
    {
        *noted = Some((key(binding), reservation.into(), model.into()));
    }
}

/// The reservation and model noted for the wallet `key`, once.
pub fn take(key: &str) -> Option<(String, String)> {
    NOTED
        .lock()
        .ok()?
        .take_if(|(noted, _, _)| noted == key)
        .map(|(_, reservation, model)| (reservation, model))
}

/// Tests: note for a wallet `key` directly.
#[cfg(any(test, feature = "test-support"))]
pub fn note_for(key: &str, reservation: &str, model: &str) {
    if valid(reservation)
        && let Ok(mut noted) = NOTED.lock()
    {
        *noted = Some((key.into(), reservation.into(), model.into()));
    }
}
