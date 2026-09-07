//! Tailwind utility grammar used by the compiler.
//!
//! There is no closed catalog of Tailwind classes: arbitrary values,
//! stacked variants, `@theme` tokens and plugins generate names at compile
//! time. What we *can* know is the shape of a utility (`variant:` + core
//! plugin prefix / bare word / `[arbitrary]`), which is enough to leave
//! custom BEM-style classes like `.header-signin` or `.btn-notch` alone.
//!
//! Vitest loads this classifier through WASM (`looks_like_tailwind_utility`).

/// Bare utilities (no hyphen) from Tailwind's default theme.
const BARE_UTILITIES: &[&str] = &[
    "absolute",
    "antialiased",
    "block",
    "blur",
    "border",
    "capitalize",
    "collapse",
    "container",
    "contents",
    "filter",
    "fixed",
    "flex",
    "grayscale",
    "grid",
    "group",
    "grow",
    "hidden",
    "inline",
    "invert",
    "invisible",
    "isolate",
    "italic",
    "lowercase",
    "ordinal",
    "outline",
    "overline",
    "peer",
    "prose",
    "relative",
    "resize",
    "ring",
    "sepia",
    "shadow",
    "shrink",
    "static",
    "sticky",
    "table",
    "transform",
    "transition",
    "truncate",
    "underline",
    "uppercase",
    "visible",
];

/// Hyphenated utilities that would need a prefix too short or too greedy
/// (`not-`, `no-`, `line-`, `drop-`) to match safely.
const EXACT_UTILITIES: &[&str] = &[
    "border-collapse",
    "border-separate",
    "box-border",
    "box-content",
    "break-all",
    "break-keep",
    "break-normal",
    "break-words",
    "caption-bottom",
    "caption-top",
    "decoration-clone",
    "decoration-slice",
    "diagonal-fractions",
    "drop-shadow",
    "flow-root",
    "inline-block",
    "inline-flex",
    "inline-grid",
    "inline-table",
    "line-through",
    "lining-nums",
    "list-item",
    "no-underline",
    "normal-case",
    "normal-nums",
    "not-italic",
    "not-sr-only",
    "oldstyle-nums",
    "overflow-ellipsis",
    "proportional-nums",
    "ring-inset",
    "scroll-auto",
    "scroll-smooth",
    "slashed-zero",
    "sr-only",
    "stacked-fractions",
    "subpixel-antialiased",
    "table-auto",
    "table-fixed",
    "tabular-nums",
    "text-balance",
    "text-nowrap",
    "text-pretty",
    "text-wrap",
];

/// Core plugin prefixes (trailing `-`). Matching is `starts_with`; order
/// does not matter for a boolean test.
const UTILITY_PREFIXES: &[&str] = &[
    "accent-",
    "align-",
    "animate-",
    "appearance-",
    "aspect-",
    "auto-cols-",
    "auto-rows-",
    "backdrop-blur-",
    "backdrop-brightness-",
    "backdrop-contrast-",
    "backdrop-grayscale-",
    "backdrop-hue-rotate-",
    "backdrop-invert-",
    "backdrop-opacity-",
    "backdrop-saturate-",
    "backdrop-sepia-",
    "backdrop-",
    "backface-",
    "basis-",
    "bg-blend-",
    "bg-conic-",
    "bg-gradient-",
    "bg-linear-",
    "bg-radial-",
    "bg-",
    "blur-",
    "border-spacing-",
    "border-x-",
    "border-y-",
    "border-s-",
    "border-e-",
    "border-t-",
    "border-r-",
    "border-b-",
    "border-l-",
    "border-",
    "bottom-",
    "box-decoration-",
    "box-",
    "break-after-",
    "break-before-",
    "break-inside-",
    "break-",
    "brightness-",
    "caption-",
    "caret-",
    "clear-",
    "col-end-",
    "col-span-",
    "col-start-",
    "col-",
    "columns-",
    "content-",
    "contrast-",
    "cursor-",
    "decoration-",
    "delay-",
    "divide-x-",
    "divide-y-",
    "divide-",
    "drop-shadow-",
    "duration-",
    "ease-",
    "end-",
    "field-sizing-",
    "fill-",
    "flex-",
    "float-",
    "font-",
    "forced-color-adjust-",
    "from-",
    "gap-x-",
    "gap-y-",
    "gap-",
    "grayscale-",
    "grid-cols-",
    "grid-flow-",
    "grid-rows-",
    "grow-",
    "h-",
    "hue-rotate-",
    "hyphens-",
    "indent-",
    "inline-",
    "inset-ring-",
    "inset-shadow-",
    "inset-x-",
    "inset-y-",
    "inset-",
    "invert-",
    "items-",
    "justify-items-",
    "justify-self-",
    "justify-",
    "leading-",
    "left-",
    "line-clamp-",
    "list-image-",
    "list-",
    "m-",
    "mask-",
    "max-h-",
    "max-w-",
    "max-",
    "mb-",
    "me-",
    "min-h-",
    "min-w-",
    "min-",
    "mix-blend-",
    "ml-",
    "mr-",
    "ms-",
    "mt-",
    "mx-",
    "my-",
    "object-",
    "opacity-",
    "order-",
    "origin-",
    "outline-offset-",
    "outline-",
    "overflow-x-",
    "overflow-y-",
    "overflow-",
    "overscroll-x-",
    "overscroll-y-",
    "overscroll-",
    "p-",
    "pb-",
    "pe-",
    "perspective-",
    "place-content-",
    "place-items-",
    "place-self-",
    "place-",
    "placeholder-",
    "pl-",
    "pointer-events-",
    "pr-",
    "prose-",
    "ps-",
    "pt-",
    "px-",
    "py-",
    "resize-",
    "right-",
    "ring-offset-",
    "ring-",
    "rotate-x-",
    "rotate-y-",
    "rotate-z-",
    "rotate-",
    "rounded-ss-",
    "rounded-se-",
    "rounded-ee-",
    "rounded-es-",
    "rounded-tl-",
    "rounded-tr-",
    "rounded-br-",
    "rounded-bl-",
    "rounded-s-",
    "rounded-e-",
    "rounded-t-",
    "rounded-r-",
    "rounded-b-",
    "rounded-l-",
    "rounded-",
    "row-end-",
    "row-span-",
    "row-start-",
    "row-",
    "saturate-",
    "scale-x-",
    "scale-y-",
    "scale-z-",
    "scale-",
    "scheme-",
    "scroll-m-",
    "scroll-p-",
    "scroll-px-",
    "scroll-py-",
    "scroll-ps-",
    "scroll-pe-",
    "scroll-pt-",
    "scroll-pr-",
    "scroll-pb-",
    "scroll-pl-",
    "scroll-mx-",
    "scroll-my-",
    "scroll-ms-",
    "scroll-me-",
    "scroll-mt-",
    "scroll-mr-",
    "scroll-mb-",
    "scroll-ml-",
    "scroll-",
    "select-",
    "self-",
    "sepia-",
    "shadow-",
    "shrink-",
    "size-",
    "skew-x-",
    "skew-y-",
    "skew-",
    "snap-",
    "space-x-",
    "space-y-",
    "space-",
    "sr-",
    "start-",
    "stroke-",
    "table-",
    "text-shadow-",
    "text-",
    "to-",
    "top-",
    "touch-",
    "tracking-",
    "transform-",
    "transition-",
    "translate-x-",
    "translate-y-",
    "translate-z-",
    "translate-",
    "underline-offset-",
    "via-",
    "w-",
    "whitespace-",
    "will-change-",
    "z-",
];

fn variant_colon_index(name: &str) -> Option<usize> {
    let bytes = name.as_bytes();
    let mut depth = 0i32;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i = (i + 2).min(bytes.len());
            continue;
        }
        match bytes[i] {
            b'[' => depth += 1,
            b']' if depth > 0 => depth -= 1,
            b':' if depth == 0 => return Some(i),
            _ => {}
        }
        i += 1;
    }
    None
}

/// Strip stacked variants (`lg:hover:`) and `!important` markers, leaving
/// the core utility (`flex`, `bg-red-500`, `content-['']`).
pub fn core_utility_name(name: &str) -> &str {
    let mut rest = name;
    loop {
        rest = rest.strip_prefix('!').unwrap_or(rest);
        match variant_colon_index(rest) {
            Some(index) => rest = &rest[index + 1..],
            None => break,
        }
    }
    rest.strip_prefix('!').unwrap_or(rest)
}

fn looks_like_tailwind_core(core: &str) -> bool {
    if core.is_empty() {
        return false;
    }
    if core.starts_with('[') || core.contains('[') {
        return true;
    }
    let unsigned = core.strip_prefix('-').unwrap_or(core);
    let base = unsigned.split_once('/').map(|(head, _)| head).unwrap_or(unsigned);
    if BARE_UTILITIES.iter().any(|item| *item == base) {
        return true;
    }
    if EXACT_UTILITIES.iter().any(|item| *item == base) {
        return true;
    }
    UTILITY_PREFIXES
        .iter()
        .any(|prefix| base.starts_with(prefix) && base.len() > prefix.len())
}

/// True for Tailwind-shaped class names, false for custom hyphenated
/// components (`.header-signin`, `.btn-notch`).
pub fn looks_like_tailwind_utility(class_name: &str) -> bool {
    let name = crate::classes::unescape_css_class_name(class_name);
    if name.is_empty() {
        return false;
    }
    looks_like_tailwind_core(core_utility_name(&name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_default_utilities() {
        for name in [
            "flex",
            "hidden",
            "p-4",
            "-mt-2",
            "px-4",
            "items-center",
            "bg-revamp-primary-default",
            "w-1/2",
            "bg-red-500/50",
            "!px-4",
            "hover:bg-red-500",
            "lg:hover:flex",
            "before:content-['']",
            "after:content-['*']",
            "w-[327px]",
            "[color:red]",
            "sr-only",
            "not-sr-only",
            "inline-flex",
            "space-y-4",
            "divide-x-2",
            "min-h-screen",
            "max-w-prose",
            "prose-headings",
            "data-[state=open]:flex",
            "sm:grid-cols-[3rem_minmax(0,1fr)_7rem]",
            "from-primary/[0.05]",
            "data-[active=true]:font-medium",
            "aria-selected:bg-red-500",
            "open:hidden",
        ] {
            assert!(
                looks_like_tailwind_utility(name),
                "expected Tailwind utility: {name}"
            );
        }
    }

    #[test]
    fn rejects_custom_hyphenated_components() {
        for name in [
            "header-signin",
            "btn-notch",
            "eye-line",
            "pattern-background",
            "slick-slide",
            "pokerenchile",
            "nexi",
            "hover:header-signin",
            "lg:btn-notch",
        ] {
            assert!(
                !looks_like_tailwind_utility(name),
                "expected custom class: {name}"
            );
        }
    }
}
