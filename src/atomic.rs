use std::collections::{HashMap, HashSet};

use lightningcss::declaration::DeclarationBlock;
use lightningcss::rules::CssRule;
use lightningcss::stylesheet::{ParserFlags, ParserOptions, PrinterOptions, StyleSheet};
use lightningcss::traits::ToCss;

use crate::classes::normalize_utility_class_name;

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
        if b == b'\\' && class_end + 1 < bytes.len() {
            class_end += 2;
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
    if !selector.contains("::") {
        return false;
    }
    if has_tailwind_variant_escape(selector) {
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
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            i += 2;
            continue;
        }
        if bytes[i] == b'(' {
            normalized.push_str("()");
            while i < bytes.len() && bytes[i] != b')' {
                i += 1;
            }
            i += 1;
            continue;
        }
        normalized.push(bytes[i] as char);
        i += 1;
    }
    normalized
        .chars()
        .any(|ch| matches!(ch, ' ' | '>' | '+' | '~'))
}

fn count_unescaped_classes(selector: &str) -> usize {
    let bytes = selector.as_bytes();
    let mut count = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i += 2;
            continue;
        }
        if bytes[i] == b'.' {
            count += 1;
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' {
                    i += 2;
                    continue;
                }
                if matches!(
                    bytes[i],
                    b' ' | b'.' | b':' | b'#' | b'[' | b']' | b'>' | b'+' | b'~' | b','
                ) {
                    break;
                }
                i += 1;
            }
            continue;
        }
        i += 1;
    }
    count
}

fn split_comma_selectors(selector: &str) -> Vec<&str> {
    selector
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect()
}

fn is_single_utility_selector(selector: &str) -> bool {
    let sel = selector.trim();
    if !sel.contains('.') {
        return false;
    }
    if is_tailwind_space_or_divide_selector(sel) {
        return true;
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
    true
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
            i += 2;
            continue;
        }
        if bytes[i] == b'.' {
            let start = i;
            i += 1;
            let class_start = i;
            while i < bytes.len() {
                if bytes[i] == b'\\' {
                    i += 2;
                    continue;
                }
                if matches!(
                    bytes[i],
                    b' ' | b'.' | b':' | b'#' | b'[' | b']' | b'>' | b'+' | b'~' | b','
                ) {
                    break;
                }
                i += 1;
            }
            let raw = &selector[class_start..i];
            return Some((start, raw.to_string()));
        }
        i += 1;
    }
    None
}

fn replace_first_class(selector: &str, new_class: &str) -> String {
    if let Some((dot_at, raw)) = first_class_in_selector(selector) {
        let mut out = String::with_capacity(selector.len());
        out.push_str(&selector[..dot_at]);
        out.push('.');
        out.push_str(new_class);
        out.push_str(&selector[dot_at + 1 + raw.len()..]);
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
    changed: bool,
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
    if original.is_empty() {
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

    ctx.class_map.insert(original, hashes);
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
                let utility = is_utility_selector(&selector);

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
    let mut ctx = EmitCtx {
        class_map: &mut class_lists,
        seen: &mut seen,
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
}
