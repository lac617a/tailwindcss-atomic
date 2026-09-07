use std::collections::{HashMap, HashSet};

use lightningcss::declaration::DeclarationBlock;
use lightningcss::rules::CssRule;
use lightningcss::stylesheet::{ParserFlags, ParserOptions, PrinterOptions, StyleSheet};
use lightningcss::traits::ToCss;

use crate::classes::normalize_utility_class_name;
use crate::tailwind::looks_like_tailwind_utility;

const TAILWIND_PSEUDO_ELEMENTS: &[&str] = &[
    "::-webkit-input-placeholder",
    "::placeholder",
    "::file-selector-button",
    "::marker",
    "::backdrop",
    "::first-line",
    "::first-letter",
    "::selection",
];

fn printer_options() -> PrinterOptions<'static> {
    PrinterOptions {
        minify: false,
        ..PrinterOptions::default()
    }
}

fn parser_options<'i>() -> ParserOptions<'i> {
    ParserOptions {
        filename: String::from("tailwind-atomic.css"),
        flags: ParserFlags::NESTING,
        error_recovery: true,
        ..ParserOptions::default()
    }
}

pub fn hash_string(input: &str) -> String {
    let mut hash: u64 = 5381;
    for byte in input.bytes() {
        hash = ((hash << 5).wrapping_add(hash)).wrapping_add(byte as u64);
    }
    format!("_{:06x}", hash & 0xFFFFFF)
}

fn to_css<T: ToCss>(value: &T) -> String {
    value.to_css_string(printer_options()).unwrap_or_default()
}

fn has_tailwind_variant_escape(selector: &str) -> bool {
    selector.contains("\\:")
}

fn is_document_or_theme_root_selector(selector: &str) -> bool {
    let sel = selector.trim();
    sel.starts_with("html")
        || sel.starts_with("body")
        || sel.starts_with(":root")
        || sel.contains("[data-theme")
}

fn is_tailwind_space_or_divide_selector(selector: &str) -> bool {
    let sel = selector.trim();
    let bytes = sel.as_bytes();
    if bytes.first() != Some(&b'.') {
        return false;
    }
    let mut class_end = 1;
    while class_end < bytes.len() {
        let b = bytes[class_end];
        if b == b'\\' {
            class_end = skip_css_escape(bytes, class_end);
            continue;
        }
        if matches!(b, b' ' | b'>' | b'+' | b'~') {
            break;
        }
        class_end += 1;
    }
    let rest = sel[class_end..].trim_start();
    rest == "> :not([hidden]) ~ :not([hidden])" || rest == ">:not([hidden])~:not([hidden])"
}

fn has_component_pseudo_element(selector: &str) -> bool {
    if has_tailwind_variant_escape(selector) {
        return false;
    }
    // lightningcss prints `:before` / `:after`; source CSS often uses `::`.
    if selector.contains(":before") || selector.contains(":after") {
        return true;
    }
    if !selector.contains("::") {
        return false;
    }
    let mut stripped = selector.to_string();
    for pseudo in TAILWIND_PSEUDO_ELEMENTS {
        stripped = stripped.replace(pseudo, "");
    }
    stripped.contains("::")
}

fn has_non_utility_combinator(selector: &str) -> bool {
    if is_tailwind_space_or_divide_selector(selector) {
        return false;
    }
    let mut normalized = String::new();
    let bytes = selector.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i = skip_css_escape(bytes, i);
            continue;
        }
        if bytes[i] == b'(' {
            normalized.push_str("()");
            while i < bytes.len() && bytes[i] != b')' {
                if bytes[i] == b'\\' {
                    i = skip_css_escape(bytes, i);
                    continue;
                }
                i += 1;
            }
            if i < bytes.len() {
                i += 1;
            }
            continue;
        }
        normalized.push(bytes[i] as char);
        i += 1;
    }
    normalized
        .chars()
        .any(|ch| matches!(ch, ' ' | '>' | '+' | '~'))
}

fn skip_css_escape(bytes: &[u8], i: usize) -> usize {
    if i < bytes.len() && bytes[i] == b'\\' {
        (i + 2).min(bytes.len())
    } else {
        i
    }
}

fn is_class_name_terminator(b: u8) -> bool {
    matches!(b, b' ' | b'.' | b':' | b'#' | b'>' | b'+' | b'~' | b',')
}

/// Scan a CSS class ident after `.`, including Tailwind arbitrary chunks (`[…]`)
/// so `.from-primary/[0.05]` stays one name instead of stopping at `[`.
fn scan_class_name_end(bytes: &[u8], mut i: usize) -> usize {
    let mut bracket = 0i32;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i = skip_css_escape(bytes, i);
            continue;
        }
        match bytes[i] {
            b'[' => {
                bracket += 1;
                i += 1;
            }
            b']' if bracket > 0 => {
                bracket -= 1;
                i += 1;
            }
            b if bracket == 0 && is_class_name_terminator(b) => break,
            _ => i += 1,
        }
    }
    i
}

fn count_unescaped_classes(selector: &str) -> usize {
    let bytes = selector.as_bytes();
    let mut count = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i = skip_css_escape(bytes, i);
            continue;
        }
        if bytes[i] == b'.' {
            count += 1;
            i = scan_class_name_end(bytes, i + 1);
            continue;
        }
        i += 1;
    }
    count
}

/// Split a selector list on top-level commas only.
/// Escaped commas (`\,`), quoted strings and nested `()` / `[]` stay intact so
/// Tailwind arbitrary values like `.transition-\[color\,box-shadow\]` remain one selector.
fn split_comma_selectors(selector: &str) -> Vec<&str> {
    let bytes = selector.as_bytes();
    let mut parts = Vec::new();
    let mut start = 0;
    let mut i = 0;
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut quote: Option<u8> = None;

    while i < bytes.len() {
        let b = bytes[i];
        if b == b'\\' {
            i = skip_css_escape(bytes, i);
            continue;
        }
        if let Some(q) = quote {
            if b == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        match b {
            b'"' | b'\'' => {
                quote = Some(b);
                i += 1;
            }
            b'(' => {
                paren += 1;
                i += 1;
            }
            b')' => {
                paren = paren.saturating_sub(1);
                i += 1;
            }
            b'[' => {
                bracket += 1;
                i += 1;
            }
            b']' => {
                bracket = bracket.saturating_sub(1);
                i += 1;
            }
            b',' if paren == 0 && bracket == 0 => {
                if let Some(part) = selector.get(start..i).map(str::trim).filter(|p| !p.is_empty())
                {
                    parts.push(part);
                }
                i += 1;
                start = i;
            }
            _ => i += 1,
        }
    }

    if let Some(part) = selector.get(start..).map(str::trim).filter(|p| !p.is_empty()) {
        parts.push(part);
    }
    parts
}

fn looks_like_css_module_class(class_name: &str) -> bool {
    if !class_name.contains("__") {
        return false;
    }
    if class_name.contains('\\') || class_name.contains('[') || class_name.contains(':') {
        return false;
    }
    true
}

fn class_token_is_tailwind_utility(selector: &str) -> bool {
    match first_class_in_selector(selector) {
        Some((_, raw)) => {
            if looks_like_css_module_class(&raw) {
                return false;
            }
            looks_like_tailwind_utility(&raw)
        }
        None => false,
    }
}

fn is_single_utility_selector(selector: &str) -> bool {
    let sel = selector.trim();
    if !sel.contains('.') {
        return false;
    }
    if is_tailwind_space_or_divide_selector(sel) {
        return class_token_is_tailwind_utility(sel);
    }
    if !has_tailwind_variant_escape(sel) {
        if is_document_or_theme_root_selector(sel) {
            return false;
        }
        if has_component_pseudo_element(sel) {
            return false;
        }
        if has_non_utility_combinator(sel) {
            return false;
        }
        if count_unescaped_classes(sel) != 1 {
            return false;
        }
    }
    class_token_is_tailwind_utility(sel)
}

pub fn is_utility_selector(selector: &str) -> bool {
    let parts = split_comma_selectors(selector);
    !parts.is_empty() && parts.iter().all(|part| is_single_utility_selector(part))
}

fn has_theme_custom_properties(block: &DeclarationBlock<'_>) -> bool {
    block.iter().any(|(prop, important)| {
        let css = prop
            .to_css_string(important, printer_options())
            .unwrap_or_default();
        let name = css.split(':').next().unwrap_or("").trim();
        name.starts_with("--") && !name.starts_with("--tw-")
    })
}

fn first_class_in_selector(selector: &str) -> Option<(usize, String)> {
    let bytes = selector.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i = skip_css_escape(bytes, i);
            continue;
        }
        if bytes[i] == b'.' {
            let start = i;
            let class_start = i + 1;
            i = scan_class_name_end(bytes, class_start);
            let raw = selector.get(class_start..i.min(selector.len()))?;
            if raw.is_empty() {
                return None;
            }
            return Some((start, raw.to_string()));
        }
        i += 1;
    }
    None
}

fn replace_first_class(selector: &str, new_class: &str) -> String {
    if let Some((dot_at, raw)) = first_class_in_selector(selector) {
        let rest_at = dot_at.saturating_add(1).saturating_add(raw.len());
        let prefix = selector.get(..dot_at).unwrap_or("");
        let suffix = selector.get(rest_at..).unwrap_or("");
        let mut out = String::with_capacity(prefix.len() + new_class.len() + suffix.len() + 1);
        out.push_str(prefix);
        out.push('.');
        out.push_str(new_class);
        out.push_str(suffix);
        return out;
    }
    format!(".{new_class}")
}

fn collect_decls(block: &DeclarationBlock<'_>) -> Vec<String> {
    let mut collected = Vec::new();
    for (prop, important) in block.iter() {
        if let Ok(css) = prop.to_css_string(important, printer_options()) {
            if !css.is_empty() {
                collected.push(css);
            }
        }
    }
    collected
}

fn wrap_at_rule(kind: &str, prelude: &str, inner: &str) -> String {
    if inner.trim().is_empty() {
        return String::new();
    }
    if prelude.is_empty() {
        format!("@{kind} {{\n{inner}\n}}\n")
    } else {
        format!("@{kind} {prelude} {{\n{inner}\n}}\n")
    }
}

fn resolve_nested_selector(parent: Option<&str>, nested: &str) -> String {
    let nested = nested.trim();
    let Some(parent) = parent.map(str::trim).filter(|sel| !sel.is_empty()) else {
        return nested.to_string();
    };
    if nested.is_empty() || nested == "&" {
        return parent.to_string();
    }
    if nested.contains('&') {
        return nested.replace('&', parent);
    }
    if nested.starts_with(':') || nested.starts_with('[') {
        return format!("{parent}{nested}");
    }
    nested.to_string()
}

fn has_declarations(block: &DeclarationBlock<'_>) -> bool {
    block.iter().next().is_some()
}

struct EmitCtx<'a> {
    class_map: &'a mut HashMap<String, Vec<String>>,
    seen: &'a mut HashSet<String>,
    component_classes: &'a HashSet<String>,
    changed: bool,
}

fn collect_component_classes(rules: &[CssRule<'_>], out: &mut HashSet<String>) {
    for rule in rules {
        match rule {
            CssRule::Style(style) => {
                let selector = to_css(&style.selectors);
                if has_component_pseudo_element(&selector) {
                    if let Some((_, raw)) = first_class_in_selector(&selector) {
                        let name = normalize_utility_class_name(&raw);
                        if !name.is_empty() {
                            out.insert(name);
                        }
                    }
                }
                collect_component_classes(&style.rules.0, out);
            }
            CssRule::Media(media) => collect_component_classes(&media.rules.0, out),
            CssRule::Supports(supports) => collect_component_classes(&supports.rules.0, out),
            CssRule::Container(container) => collect_component_classes(&container.rules.0, out),
            CssRule::LayerBlock(layer) => collect_component_classes(&layer.rules.0, out),
            CssRule::StartingStyle(starting) => collect_component_classes(&starting.rules.0, out),
            _ => {}
        }
    }
}

fn emit_style_rule(
    selector: &str,
    block: &DeclarationBlock<'_>,
    nested_empty: bool,
    ctx: &mut EmitCtx<'_>,
) -> String {
    if !nested_empty || has_theme_custom_properties(block) || !is_utility_selector(selector) {
        return String::new();
    }

    let Some((_, raw_class)) = first_class_in_selector(selector) else {
        return String::new();
    };
    let original = normalize_utility_class_name(&raw_class);
    if original.is_empty() || ctx.component_classes.contains(&original) {
        return String::new();
    }

    let decls = collect_decls(block);
    if decls.is_empty() {
        return String::new();
    }

    let mut hashes = Vec::new();
    let mut css = String::new();
    for decl in decls {
        let hash = hash_string(&format!("{original}\0{decl}"));
        let next_selector = replace_first_class(selector, &hash);
        let rule = format!("{next_selector} {{ {decl} }}");
        hashes.push(hash);
        if ctx.seen.insert(rule.clone()) {
            css.push_str(&rule);
            css.push('\n');
        }
    }

    if hashes.is_empty() {
        return String::new();
    }

    let entry = ctx.class_map.entry(original).or_default();
    for hash in hashes {
        if !entry.contains(&hash) {
            entry.push(hash);
        }
    }
    ctx.changed = true;
    css
}

fn emit_at_rule_or_original(
    kind: &str,
    prelude: &str,
    inner: String,
    original: &CssRule<'_>,
    out: &mut String,
) {
    if inner.trim().is_empty() {
        out.push_str(&to_css(original));
        out.push('\n');
        return;
    }
    out.push_str(&wrap_at_rule(kind, prelude, &inner));
}

fn emit_rules(
    rules: &[CssRule<'_>],
    parent_selector: Option<&str>,
    ctx: &mut EmitCtx<'_>,
) -> String {
    let mut out = String::new();
    for rule in rules {
        match rule {
            CssRule::LayerBlock(layer) => {
                out.push_str(&emit_rules(&layer.rules.0, parent_selector, ctx));
            }
            CssRule::LayerStatement(_) => {}
            CssRule::Media(media) => {
                let inner = emit_rules(&media.rules.0, parent_selector, ctx);
                emit_at_rule_or_original("media", &to_css(&media.query), inner, rule, &mut out);
            }
            CssRule::Supports(supports) => {
                let inner = emit_rules(&supports.rules.0, parent_selector, ctx);
                emit_at_rule_or_original(
                    "supports",
                    &to_css(&supports.condition),
                    inner,
                    rule,
                    &mut out,
                );
            }
            CssRule::Container(container) => {
                let prelude = match (&container.name, &container.condition) {
                    (Some(name), Some(condition)) => {
                        format!("{} {}", to_css(name), to_css(condition))
                    }
                    (Some(name), None) => to_css(name),
                    (None, Some(condition)) => to_css(condition),
                    (None, None) => String::new(),
                };
                let inner = emit_rules(&container.rules.0, parent_selector, ctx);
                emit_at_rule_or_original("container", prelude.trim(), inner, rule, &mut out);
            }
            CssRule::StartingStyle(starting) => {
                let inner = emit_rules(&starting.rules.0, parent_selector, ctx);
                emit_at_rule_or_original("starting-style", "", inner, rule, &mut out);
            }
            CssRule::NestedDeclarations(decls) => {
                if let Some(selector) = parent_selector {
                    let atomic = emit_style_rule(selector, &decls.declarations, true, ctx);
                    if atomic.is_empty() {
                        out.push_str(&to_css(rule));
                        out.push('\n');
                    } else {
                        out.push_str(&atomic);
                    }
                } else {
                    out.push_str(&to_css(rule));
                    out.push('\n');
                }
            }
            CssRule::Style(style) => {
                let raw_selector = to_css(&style.selectors);
                let selector = resolve_nested_selector(parent_selector, &raw_selector);
                let nested_empty = style.rules.0.is_empty();
                let theme_tokens = has_theme_custom_properties(&style.declarations);
                let utility = is_utility_selector(&selector)
                    && first_class_in_selector(&selector)
                        .map(|(_, raw)| {
                            !ctx.component_classes
                                .contains(&normalize_utility_class_name(&raw))
                        })
                        .unwrap_or(true);

                // Skins / componentes con anidación: no desanidar.
                if (!utility || theme_tokens) && !nested_empty {
                    out.push_str(&to_css(style));
                    out.push('\n');
                    continue;
                }

                let mut emitted = String::new();
                if has_declarations(&style.declarations) {
                    emitted.push_str(&emit_style_rule(
                        &selector,
                        &style.declarations,
                        true,
                        ctx,
                    ));
                }
                if !nested_empty {
                    // Tailwind v4: `.lg\:flex { @media { display: flex } }` y `&:hover`.
                    emitted.push_str(&emit_rules(&style.rules.0, Some(&selector), ctx));
                }

                if !emitted.is_empty() {
                    out.push_str(&emitted);
                } else {
                    out.push_str(&to_css(style));
                    out.push('\n');
                }
            }
            CssRule::Ignored => {}
            other => {
                out.push_str(&to_css(other));
                out.push('\n');
            }
        }
    }
    out
}

pub struct AtomicOutput {
    pub class_map: HashMap<String, String>,
    pub css: String,
    pub css_rules: Vec<String>,
    pub changed: bool,
}

pub fn atomicize_stylesheet(raw_css: &str) -> Result<AtomicOutput, String> {
    let stylesheet = StyleSheet::parse(raw_css, parser_options())
        .map_err(|error| format!("Error parseando CSS: {error:?}"))?;

    let mut class_lists: HashMap<String, Vec<String>> = HashMap::new();
    let mut seen = HashSet::new();
    let mut component_classes = HashSet::new();
    collect_component_classes(&stylesheet.rules.0, &mut component_classes);
    let mut ctx = EmitCtx {
        class_map: &mut class_lists,
        seen: &mut seen,
        component_classes: &component_classes,
        changed: false,
    };
    let css = emit_rules(&stylesheet.rules.0, None, &mut ctx);
    let changed = ctx.changed;

    let css_rules: Vec<String> = css
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("._") || line.contains("._"))
        .filter(|line| line.contains('{'))
        .map(ToString::to_string)
        .collect();

    let class_map = class_lists
        .into_iter()
        .map(|(key, hashes)| {
            let mut unique = Vec::new();
            for hash in hashes {
                if !unique.contains(&hash) {
                    unique.push(hash);
                }
            }
            (key, unique.join(" "))
        })
        .collect();

    Ok(AtomicOutput {
        class_map,
        css,
        css_rules,
        changed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_hover_on_the_selector() {
        let out =
            atomicize_stylesheet(".hover\\:bg-red-500:hover { background-color: red }").unwrap();
        let hashed = out.class_map.get("hover:bg-red-500").expect("mapped");
        assert!(out.css.contains(&format!(".{hashed}:hover")));
        assert!(!out.css.contains(".hover\\:bg-red-500"));
    }

    #[test]
    fn keeps_space_combinators() {
        let out = atomicize_stylesheet(
            ".space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem }",
        )
        .unwrap();
        let hashed = out.class_map.get("space-y-4").expect("mapped");
        assert!(
            out.css
                .contains(&format!(".{hashed} > :not([hidden]) ~ :not([hidden])"))
        );
    }

    #[test]
    fn does_not_atomicize_css_module_locals() {
        let out = atomicize_stylesheet(
            ".Nexi_svg__def34 { display: block; width: 100% } .flex { display: flex }",
        )
        .unwrap();
        assert!(out.css.contains(".Nexi_svg__def34"));
        assert!(out.css.contains("display: block"));
        assert!(out.class_map.get("Nexi_svg__def34").is_none());
        assert!(out.class_map.get("flex").is_some());
        assert!(!out.css.contains(".flex"));
    }

    #[test]
    fn still_atomicizes_arbitrary_values_that_contain_underscores() {
        let out = atomicize_stylesheet(".w-\\[1fr__2fr\\] { width: 1fr }").unwrap();
        assert!(out.changed);
        assert!(out.class_map.len() >= 1);
        assert!(!out.css.contains("1fr__2fr") || out.css.contains("._"));
    }

    #[test]
    fn does_not_atomicize_theme_tokens() {
        let out = atomicize_stylesheet(
            ".pokerenchile { --color-red-600: #bc0000 } .flex { display: flex }",
        )
        .unwrap();
        assert!(out.css.contains(".pokerenchile"));
        assert!(out.class_map.get("pokerenchile").is_none());
        assert!(out.class_map.get("flex").is_some());
    }

    #[test]
    fn keeps_responsive_variants_inside_media() {
        let out = atomicize_stylesheet(
            ".top-0 { top: 0 } @media (min-width: 640px) { .sm\\:top-0 { top: 0 } }",
        )
        .unwrap();
        let base = out.class_map.get("top-0").expect("base");
        let sm = out.class_map.get("sm:top-0").expect("sm");
        assert_ne!(base, sm);
        assert!(out.css.contains("@media"));
        assert!(out.css.contains(&format!(".{sm}")));
    }

    #[test]
    fn atomicizes_tailwind_v4_nested_breakpoint_variants() {
        let out = atomicize_stylesheet(
            r#"
.hidden { display: none }
.items-center { align-items: center }
.gap-8 { gap: 2rem }
.lg\:flex {
  @media (width >= 64rem) {
    display: flex;
  }
}
"#,
        )
        .unwrap();

        let hidden = out.class_map.get("hidden").expect("hidden");
        let lg_flex = out.class_map.get("lg:flex").expect("lg:flex");
        assert_ne!(hidden, lg_flex);
        assert!(out.css.contains("@media"));
        assert!(out.css.contains(&format!(".{lg_flex}")));
        assert!(out.css.contains("display: flex"));
        assert!(!out.css.contains(".lg\\:flex"));
        assert!(!out.css.contains(".hidden {"));
    }

    #[test]
    fn atomicizes_tailwind_v4_nested_hover() {
        let out = atomicize_stylesheet(
            r#".hover\:bg-red-500 { &:hover { background-color: red; } }"#,
        )
        .unwrap();
        let hashed = out.class_map.get("hover:bg-red-500").expect("hover");
        assert!(out.css.contains(&format!(".{hashed}:hover")));
        assert!(!out.css.contains(".hover\\:bg-red-500"));
    }

    #[test]
    fn atomicizes_before_and_after_pseudo_elements() {
        let out = atomicize_stylesheet(
            r#"
.before\:block::before { content: var(--tw-content); display: block }
.after\:content-\[\'\'\]::after { content: var(--tw-content); content: "" }
.before\:absolute { &::before { content: var(--tw-content); position: absolute } }
.after\:inset-0 { &::after { content: var(--tw-content); inset: 0px } }
"#,
        )
        .unwrap();

        let first_hash = |key: &str| {
            out.class_map
                .get(key)
                .expect(key)
                .split_whitespace()
                .next()
                .expect("hash")
        };

        let before_block = first_hash("before:block");
        let after_content = first_hash("after:content-['']");
        let before_abs = first_hash("before:absolute");
        let after_inset = first_hash("after:inset-0");

        assert!(
            out.css.contains(&format!(".{before_block}:before")),
            "flat before:block css: {}",
            out.css
        );
        assert!(
            out.css.contains(&format!(".{after_content}:after")),
            "flat after:content css: {}",
            out.css
        );
        assert!(
            out.css.contains(&format!(".{before_abs}:before")),
            "nested before:absolute css: {}",
            out.css
        );
        assert!(
            out.css.contains(&format!(".{after_inset}:after")),
            "nested after:inset-0 css: {}",
            out.css
        );
        assert!(!out.css.contains(".before\\:block"));
        assert!(!out.css.contains(".after\\:content-"));
        assert!(!out.css.contains(".before\\:absolute"));
    }

    #[test]
    fn atomicizes_nested_lg_hover_flex() {
        let out = atomicize_stylesheet(
            r#"
.lg\:hover\:flex {
  @media (width >= 64rem) {
    &:hover {
      display: flex;
    }
  }
}
"#,
        )
        .unwrap();
        let hashed = out.class_map.get("lg:hover:flex").expect("lg:hover:flex");
        assert!(out.css.contains("@media"));
        assert!(out.css.contains(&format!(".{hashed}:hover")));
        assert!(out.css.contains("display: flex"));
    }

    #[test]
    fn atomicizes_lg_flex_inside_media_range_query() {
        let out = atomicize_stylesheet(
            r#"
.hidden { display: none }
@media (width >= 64rem) {
  .lg\:flex { display: flex }
}
"#,
        )
        .unwrap();

        let lg_flex = out.class_map.get("lg:flex").expect("lg:flex");
        assert!(out.css.contains("@media"));
        assert!(out.css.contains(&format!(".{lg_flex}")));
        assert!(out.css.contains("display: flex"));
    }

    #[test]
    fn flattens_layers() {
        let out = atomicize_stylesheet("@layer utilities { .flex { display: flex } }").unwrap();
        assert!(!out.css.contains("@layer"));
        assert!(out.class_map.get("flex").is_some());
    }

    #[test]
    fn preserves_theme_inline_custom_variant_and_oklch() {
        let out = atomicize_stylesheet(
            r#"
@custom-variant dark (&:is(.dark *));
@theme inline {
  --color-background: var(--background);
  --color-primary: var(--primary);
}
:root {
  --background: oklch(1 0 0);
  --primary: oklch(0.21 0.006 285.885);
}
.dark {
  --background: oklch(0.141 0.005 285.823);
  --primary: oklch(0.92 0.004 286.32);
}
.bg-background { background-color: var(--background); }
.bg-primary { background-color: var(--primary); }
.flex { display: flex; }
"#,
        )
        .unwrap();

        assert!(out.css.contains("@theme inline"));
        assert!(out.css.contains("--color-background: var(--background)"));
        assert!(out.css.contains("@custom-variant dark"));
        assert!(out.css.contains(":root"));
        assert!(out.css.contains("oklch"));
        assert!(out.css.contains(".dark"));
        assert!(out.class_map.get("flex").is_some());
        assert!(out.class_map.get("bg-background").is_some());
        assert!(out.class_map.get("dark").is_none());
    }

    #[test]
    fn escaped_commas_in_arbitrary_values_do_not_panic() {
        let cases = [
            (".flex{display:flex}", "flex"),
            (".w-\\[calc\\(100px\\)\\]{width:calc(100px)}", "w-[calc(100px)]"),
            (".\\[color\\:red\\]{color:red}", "[color:red]"),
            (
                ".transition-\\[color\\,box-shadow\\]{transition-property:color,box-shadow}",
                "transition-[color,box-shadow]",
            ),
            (
                ".grid-cols-\\[repeat\\(auto-fill\\,minmax\\(220px\\,1fr\\)\\)\\]{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}",
                "grid-cols-[repeat(auto-fill,minmax(220px,1fr))]",
            ),
            (
                ".\\[transition-timing-function\\:cubic-bezier\\(0\\.34\\,1\\.56\\,0\\.64\\,1\\)\\]{transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)}",
                "[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]",
            ),
            (
                ".sm\\:grid-cols-\\[3rem_minmax\\(0\\,1fr\\)_7rem\\]{grid-template-columns:3rem minmax(0,1fr) 7rem}",
                "sm:grid-cols-[3rem_minmax(0,1fr)_7rem]",
            ),
            (
                ".\\[\\&\\:hover\\>svg\\]\\:drop-shadow-\\[0_0_6px_rgba\\(250\\,204\\,21\\,0\\.4\\)\\]{filter:drop-shadow(0 0 6px rgba(250,204,21,.4))}",
                "[&:hover>svg]:drop-shadow-[0_0_6px_rgba(250,204,21,0.4)]",
            ),
        ];
        for (css, key) in cases {
            let out = atomicize_stylesheet(css).unwrap_or_else(|e| panic!("failed {css}: {e}"));
            assert!(
                out.class_map.contains_key(key),
                "missing {key} in {:?} for {css}",
                out.class_map.keys().collect::<Vec<_>>()
            );
            assert!(out.changed, "expected change for {css}");
        }

        let custom = atomicize_stylesheet(".a\\,b{color:red}").unwrap();
        assert!(
            custom.class_map.get("a,b").is_none(),
            "escaped-comma custom class must not be hashed"
        );
        assert!(custom.css.contains(".a\\,b") || custom.css.contains("a\\,b"));
    }

    #[test]
    fn preserves_custom_hyphenated_component_classes() {
        let out = atomicize_stylesheet(
            r#"
.header-signin { color: red }
.btn-notch { display: flex }
.eye-line { width: 1px }
.flex { display: flex }
.p-4 { padding: 1rem }
.items-center { align-items: center }
.bg-revamp-primary-default { background-color: var(--x) }
.before\:content-\[\'\'\]::before { content: var(--tw-content); content: "" }
"#,
        )
        .unwrap();

        assert!(out.css.contains(".header-signin"));
        assert!(out.css.contains(".btn-notch"));
        assert!(out.css.contains(".eye-line"));
        assert!(out.class_map.get("header-signin").is_none());
        assert!(out.class_map.get("btn-notch").is_none());
        assert!(out.class_map.get("eye-line").is_none());

        assert!(out.class_map.get("flex").is_some());
        assert!(out.class_map.get("p-4").is_some());
        assert!(out.class_map.get("items-center").is_some());
        assert!(out.class_map.get("bg-revamp-primary-default").is_some());
        assert!(out.class_map.get("before:content-['']").is_some());
        assert!(!out.css.contains(".flex {"));
        assert!(!out.css.contains(".p-4 {"));
    }

    #[test]
    fn preserves_component_base_when_pseudo_elements_exist() {
        let out = atomicize_stylesheet(
            r#"
.header-signin {
  position: relative;
  isolation: isolate;
  background-color: var(--primary);
}
.header-signin::before {
  content: "";
  position: absolute;
}
.header-signin::after {
  content: "";
}
.flex { display: flex }
"#,
        )
        .unwrap();

        assert!(out.css.contains(".header-signin"));
        assert!(out.css.contains(".header-signin:before") || out.css.contains(".header-signin::before"));
        assert!(out.class_map.get("header-signin").is_none());
        assert!(out.class_map.get("flex").is_some());
        assert!(!out.css.contains(".flex {"));
    }

    #[test]
    fn atomicizes_supports_color_mix_arbitrary_opacity() {
        let out = atomicize_stylesheet(
            r#"
@supports (color:color-mix(in lab,red,red)) {
  .from-primary\/\[0\.05\] {
    --tw-gradient-from: color-mix(in oklab, var(--primary) 5%, transparent);
  }
}
"#,
        )
        .unwrap();

        assert!(
            out.class_map.get("from-primary/[0.05]").is_some(),
            "css={}\nkeys={:?}",
            out.css,
            out.class_map.keys().collect::<Vec<_>>()
        );
        assert!(out.css.contains("@supports"), "css={}", out.css);
        assert!(
            out.css.contains("color-mix") && out.css.contains("--tw-gradient-from"),
            "css={}",
            out.css
        );
        assert!(
            !out.css.contains(".from-primary"),
            "original selector leaked: {}",
            out.css
        );
        let hashed = out.class_map.get("from-primary/[0.05]").unwrap();
        assert!(out.css.contains(&format!(".{hashed}")));

        let rewritten = crate::classes::rewrite_class_string(
            "bg-gradient-to-b from-primary/[0.05] to-transparent",
            &out.class_map,
        );
        assert!(
            rewritten.contains(hashed.split_whitespace().next().unwrap()),
            "rewritten={rewritten}"
        );
        assert!(!rewritten.contains("from-primary/[0.05]"));
    }
}
