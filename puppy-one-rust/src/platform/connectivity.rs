//! Local link availability, analogous to `navigator.onLine`. This is not a
//! reachability test for any server; errors/unsupported hosts remain unknown.
//! No DNS, HTTP, or other network requests are made by this adapter.
#[cfg(unix)]
pub fn online() -> Option<bool> {
    let mut head = std::ptr::null_mut();
    // SAFETY: getifaddrs writes its owned list; all nodes/addresses stay valid
    // until the matching freeifaddrs below, and nullable addresses are checked.
    unsafe {
        if libc::getifaddrs(&mut head) != 0 {
            return None;
        }
        let mut current = head;
        let mut online = false;
        while let Some(interface) = current.as_ref() {
            let family = interface.ifa_addr.as_ref().map(|a| i32::from(a.sa_family));
            if usable_interface(interface.ifa_flags, family) {
                online = true;
                break;
            }
            current = interface.ifa_next;
        }
        if !head.is_null() {
            libc::freeifaddrs(head);
        }
        Some(online)
    }
}
#[cfg(unix)]
fn usable_interface(flags: u32, family: Option<i32>) -> bool {
    let active = (libc::IFF_UP | libc::IFF_RUNNING) as u32;
    flags & active == active
        && flags & libc::IFF_LOOPBACK as u32 == 0
        && matches!(family, Some(libc::AF_INET | libc::AF_INET6))
}

#[cfg(windows)]
pub fn online() -> Option<bool> {
    use windows::Win32::NetworkManagement::{
        IpHelper::{FreeMibTable, GetIfTable2, IF_TYPE_SOFTWARE_LOOPBACK},
        Ndis::IfOperStatusUp,
    };
    let mut table = std::ptr::null_mut();
    // SAFETY: Windows allocates the table and its counted, correctly aligned
    // trailing rows. Use the generated row stride and release that allocation.
    unsafe {
        if GetIfTable2(&mut table).is_err() || table.is_null() {
            return None;
        }
        let rows =
            std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize);
        let online = rows
            .iter()
            .any(|r| r.OperStatus == IfOperStatusUp && r.Type != IF_TYPE_SOFTWARE_LOOPBACK);
        FreeMibTable(table.cast());
        Some(online)
    }
}

#[cfg(not(any(unix, windows)))]
pub fn online() -> Option<bool> {
    None
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn online_requires_an_active_non_loopback_ip_interface() {
        let active = (libc::IFF_UP | libc::IFF_RUNNING) as u32;
        for family in [libc::AF_INET, libc::AF_INET6] {
            assert!(usable_interface(active, Some(family)));
            assert!(!usable_interface(
                active | libc::IFF_LOOPBACK as u32,
                Some(family)
            ));
            assert!(!usable_interface(libc::IFF_UP as u32, Some(family)));
            assert!(!usable_interface(libc::IFF_RUNNING as u32, Some(family)));
            assert!(!usable_interface(0, Some(family)));
        }
        assert!(!usable_interface(active, None));
        assert!(!usable_interface(active, Some(libc::AF_UNIX)));
    }
    #[test]
    fn real_interface_enumeration_returns_a_known_state_without_network_io() {
        assert!(
            online().is_some(),
            "the local OS interface query must succeed"
        );
    }
}
