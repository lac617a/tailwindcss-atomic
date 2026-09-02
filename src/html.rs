use std::collections::HashMap;

use crate::classes::rewrite_class_string;

fn is_ident_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '-'
}

fn starts_with_ignore_ascii_case(haystack: &str, needle: &str) -> bool {
    haystack.len() >= needle.len() && haystack[..needle.len()].eq_ignore_ascii_case(needle)
}

/// Rewrite `class` / `className` attributes in HTML-like markup.
/// Keeps quotes and surrounding source intact (same role as mangle's htmlHandler).
pub fn rewrite_html_classes(html: &str, class_map: &HashMap<String, String>) -> String {
    if html.is_empty() || class_map.is_empty() {
        return html.to_string();
    }

    let mut out = String::with_capacity(html.len());
    let chars: Vec<char> = html.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let rest: String = chars[i..].iter().collect();
        let prev_ok = i == 0 || !is_ident_char(chars[i - 1]);
        let attr = if prev_ok && starts_with_ignore_ascii_case(&rest, "classname") {
            Some("className")
        } else if prev_ok && starts_with_ignore_ascii_case(&rest, "class") {
            let after = rest.get("class".len()..).unwrap_or("");
            if after.starts_with('=') || after.chars().next().is_some_and(|ch| ch.is_whitespace()) {
                Some("class")
            } else {
                None
            }
        } else {
            None
        };

        if let Some(name) = attr {
            let name_len = name.len();
            let mut j = i + name_len;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && chars[j] == '=' {
                j += 1;
                while j < chars.len() && chars[j].is_whitespace() {
                    j += 1;
                }
                if j < chars.len() && (chars[j] == '"' || chars[j] == '\'') {
                    let quote = chars[j];
                    j += 1;
                    let value_start = j;
                    while j < chars.len() && chars[j] != quote {
                        j += 1;
                    }
                    let value: String = chars[value_start..j].iter().collect();
                    let rewritten = rewrite_class_string(&value, class_map);
                    out.push_str(&chars[i..value_start].iter().collect::<String>());
                    out.push_str(&rewritten);
                    if j < chars.len() {
                        out.push(quote);
                        i = j + 1;
                    } else {
                        i = j;
                    }
                    continue;
                }
            }
        }

        out.push(chars[i]);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_html_and_jsx_class_attributes() {
        let mut map = HashMap::new();
        map.insert("flex".into(), "_aaaaaa".into());
        map.insert("p-6".into(), "_bbbbbb".into());
        assert_eq!(
            rewrite_html_classes(
                r#"<div class="flex p-6" className="flex" id="flex"></div>"#,
                &map
            ),
            r#"<div class="_aaaaaa _bbbbbb" className="_aaaaaa" id="flex"></div>"#
        );
    }
}
