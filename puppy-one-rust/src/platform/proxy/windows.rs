//! Windows system proxy resolution via WinHTTP (WPAD, PAC URL, and WinINET
//! manual proxy + bypass lists).
use super::{Answer, matches_bypass_list, parse_proxy_list};
use std::ffi::c_void;
use windows::{
    Win32::{
        Foundation::{GlobalFree, HGLOBAL},
        Networking::WinHttp::{
            WINHTTP_ACCESS_TYPE_NAMED_PROXY, WINHTTP_ACCESS_TYPE_NO_PROXY,
            WINHTTP_AUTO_DETECT_TYPE_DHCP, WINHTTP_AUTO_DETECT_TYPE_DNS_A,
            WINHTTP_AUTOPROXY_AUTO_DETECT, WINHTTP_AUTOPROXY_CONFIG_URL, WINHTTP_AUTOPROXY_OPTIONS,
            WINHTTP_CURRENT_USER_IE_PROXY_CONFIG, WINHTTP_PROXY_INFO, WinHttpCloseHandle,
            WinHttpGetIEProxyConfigForCurrentUser, WinHttpGetProxyForUrl, WinHttpOpen,
        },
    },
    core::{BOOL, PCWSTR, PWSTR},
};

fn free_pwstr(ptr: PWSTR) {
    if !ptr.is_null() {
        // SAFETY: WinHTTP allocates strings via GlobalAlloc; caller must GlobalFree them.
        let _ = unsafe { GlobalFree(Some(HGLOBAL(ptr.0.cast()))) };
    }
}

fn pwstr_to_string(ptr: PWSTR) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: valid NUL-terminated UTF-16 string allocated by WinHTTP.
    unsafe { ptr.to_string().ok() }.filter(|s| !s.trim().is_empty())
}

struct IeConfig(WINHTTP_CURRENT_USER_IE_PROXY_CONFIG);

impl IeConfig {
    fn query() -> Option<Self> {
        let mut cfg = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG::default();
        // SAFETY: `cfg` is zero-initialized and owned by `Self` for cleanup.
        unsafe { WinHttpGetIEProxyConfigForCurrentUser(&mut cfg) }
            .ok()
            .map(|()| Self(cfg))
    }
}

impl Drop for IeConfig {
    fn drop(&mut self) {
        free_pwstr(self.0.lpszAutoConfigUrl);
        free_pwstr(self.0.lpszProxy);
        free_pwstr(self.0.lpszProxyBypass);
    }
}

struct ProxyInfo(WINHTTP_PROXY_INFO);

impl Drop for ProxyInfo {
    fn drop(&mut self) {
        free_pwstr(self.0.lpszProxy);
        free_pwstr(self.0.lpszProxyBypass);
    }
}

struct Session(*mut c_void);

impl Session {
    fn open() -> Option<Self> {
        let agent: Vec<u16> = "PuppyOne\0".encode_utf16().collect();
        // SAFETY: NUL-terminated UTF-16 agent name; closed in Drop.
        let handle = unsafe {
            WinHttpOpen(
                PCWSTR(agent.as_ptr()),
                WINHTTP_ACCESS_TYPE_NO_PROXY,
                PCWSTR::null(),
                PCWSTR::null(),
                0,
            )
        };
        (!handle.is_null()).then_some(Self(handle))
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: handle returned by WinHttpOpen.
            let _ = unsafe { WinHttpCloseHandle(self.0) };
        }
    }
}

pub(super) fn uses_custom_proxy() -> bool {
    let Some(cfg) = IeConfig::query() else {
        return false;
    };
    cfg.0.fAutoDetect.as_bool() || !cfg.0.lpszAutoConfigUrl.is_null() || !cfg.0.lpszProxy.is_null()
}

pub(super) fn proxy_for(url: &reqwest::Url) -> Answer {
    let cfg = IeConfig::query()?;
    let host = url.host_str().unwrap_or_default();
    let scheme = url.scheme();

    // 1. Evaluate WPAD / PAC URL through WinHTTP when configured.
    let auto_detect = cfg.0.fAutoDetect.as_bool();
    let auto_config = pwstr_to_string(cfg.0.lpszAutoConfigUrl);
    if (auto_detect || auto_config.is_some())
        && let Some(session) = Session::open()
    {
        let mut flags = 0u32;
        let mut detect_flags = 0u32;
        if auto_detect {
            flags |= WINHTTP_AUTOPROXY_AUTO_DETECT;
            detect_flags = WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A;
        }
        let pac_wide: Option<Vec<u16>> = auto_config
            .as_deref()
            .map(|u| u.encode_utf16().chain(std::iter::once(0)).collect());
        if pac_wide.is_some() {
            flags |= WINHTTP_AUTOPROXY_CONFIG_URL;
        }
        let mut options = WINHTTP_AUTOPROXY_OPTIONS {
            dwFlags: flags,
            dwAutoDetectFlags: detect_flags,
            lpszAutoConfigUrl: pac_wide
                .as_ref()
                .map_or(PCWSTR::null(), |w| PCWSTR(w.as_ptr())),
            lpvReserved: std::ptr::null_mut(),
            dwReserved: 0,
            fAutoLogonIfChallenged: BOOL(1),
        };
        let target_wide: Vec<u16> = url
            .as_str()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut info = ProxyInfo(WINHTTP_PROXY_INFO::default());
        // SAFETY: valid session handle, UTF-16 URL, and initialized structs.
        if unsafe {
            WinHttpGetProxyForUrl(
                session.0,
                PCWSTR(target_wide.as_ptr()),
                &mut options,
                &mut info.0,
            )
        }
        .is_ok()
            && info.0.dwAccessType == WINHTTP_ACCESS_TYPE_NAMED_PROXY
        {
            if let Some(bypass) = pwstr_to_string(info.0.lpszProxyBypass)
                && matches_bypass_list(host, &bypass)
            {
                return None;
            }
            if let Some(list) = pwstr_to_string(info.0.lpszProxy) {
                return parse_proxy_list(&list, scheme);
            }
        }
    }

    // 2. Fall back to static WinINET proxy configuration.
    if let Some(bypass) = pwstr_to_string(cfg.0.lpszProxyBypass)
        && matches_bypass_list(host, &bypass)
    {
        return None;
    }
    let list = pwstr_to_string(cfg.0.lpszProxy)?;
    parse_proxy_list(&list, scheme)
}
