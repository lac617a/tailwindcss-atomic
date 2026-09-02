use std::collections::HashMap;

const VARIANT_PSEUDOS: &[&str] = &[
    "hover",
    "focus",
    "active",
    "disabled",
    "visited",
    "focus-within",
    "focus-visible",
    "checked",
    "required",
    "optional",
    "valid",
    "invalid",
    "first",
    "last",
    "odd",
    "even",
    "empty",
    "target",
    "enabled",
    "indeterminate",
    "default",
    "open",
    "autofill",
    "placeholder-shown",
    "read-only",
    "pressed",
];

pub fn unescape_css_class_name(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = String::with_capacity(value.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            let next = bytes[i + 1];
            if is_hex_digit(next) {
                let mut j = i + 1;
                let mut hex = String::new();
                while j < bytes.len() && hex.len() < 6 && is_hex_digit(bytes[j]) {
                    hex.push(bytes[j] as char);
                    j += 1;
                }
                if j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\n' | b'\r' | 0x0c) {
                    j += 1;
                }
                if let Ok(code) = u32::from_str_radix(&hex, 16) {
                    if let Some(ch) = char::from_u32(code) {
                        out.push(ch);
                    }
                }
                i = j;
                continue;
            }
            if next != b'\n' && next != b'\r' && next != 0x0c {
                out.push(next as char);
                i += 2;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn is_hex_digit(b: u8) -> bool {
    matches!(b, b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F')
}

pub fn strip_redundant_variant_pseudo(key: &str) -> String {
    let Some(last_colon) = key.rfind(':') else {
        return key.to_string();
    };
    if last_colon == 0 {
        return key.to_string();
    }
    let pseudo = &key[last_colon + 1..];
    if !VARIANT_PSEUDOS.iter().any(|name| *name == pseudo) {
        return key.to_string();
    }
    let rest = &key[..last_colon];
    if rest == pseudo
        || rest.starts_with(&format!("{pseudo}:"))
        || rest.contains(&format!(":{pseudo}:"))
        || rest.ends_with(&format!(":{pseudo}"))
    {
        return rest.to_string();
    }
    key.to_string()
}

pub fn normalize_arbitrary_hex(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    let bytes = key.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' && i + 1 < bytes.len() && bytes[i + 1] == b'#' {
            out.push('[');
            out.push('#');
            i += 2;
            while i < bytes.len() && bytes[i] != b']' {
                out.push((bytes[i] as char).to_ascii_lowercase());
                i += 1;
            }
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

pub fn normalize_utility_class_name(value: &str) -> String {
    normalize_arbitrary_hex(&strip_redundant_variant_pseudo(&unescape_css_class_name(
        value,
    )))
}

pub fn lookup_mapped_class<'a>(
    cls: &str,
    class_map: &'a HashMap<String, String>,
) -> Option<&'a str> {
    if let Some(mapped) = class_map.get(cls) {
        return Some(mapped.as_str());
    }
    let unescaped = unescape_css_class_name(cls);
    if unescaped != cls {
        if let Some(mapped) = class_map.get(&unescaped) {
            return Some(mapped.as_str());
        }
    }
    let normalized = normalize_utility_class_name(cls);
    class_map.get(&normalized).map(String::as_str)
}

/// Split on whitespace / quotes (same idea as tailwindcss-mangle `splitCode`)
/// and replace known utilities. Longer keys win when a token could match two
/// map entries (`bg-red-500/50` before `bg-red-500`).
pub fn rewrite_class_string(class_str: &str, class_map: &HashMap<String, String>) -> String {
    if class_str.is_empty() || class_map.is_empty() {
        return class_str.to_string();
    }

    class_str
        .split(|ch: char| ch.is_whitespace() || ch == '"' || ch == '\'')
        .filter(|token| !token.is_empty())
        .map(|token| {
            lookup_mapped_class(token, class_map)
                .unwrap_or(token)
                .to_string()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unescapes_variant_colons() {
        assert_eq!(unescape_css_class_name("hover\\:flex"), "hover:flex");
        assert_eq!(unescape_css_class_name("\\!px-4"), "!px-4");
    }

    #[test]
    fn strips_trailing_variant_pseudos() {
        assert_eq!(
            strip_redundant_variant_pseudo("hover:bg-red-500:hover"),
            "hover:bg-red-500"
        );
        assert_eq!(strip_redundant_variant_pseudo("flex"), "flex");
    }

    #[test]
    fn rewrites_known_tokens() {
        let mut map = HashMap::new();
        map.insert("flex".into(), "_aaaaaa".into());
        map.insert("hover:bg-red-500".into(), "_bbbbbb".into());
        assert_eq!(
            rewrite_class_string("flex extra hover:bg-red-500", &map),
            "_aaaaaa extra _bbbbbb"
        );
    }
}
