//! Atomic CSS compiler for Tailwind utilities.
//!
//! Takes compiled Tailwind CSS, splits each utility into one class per
//! declaration, and rewrites class strings / HTML to the hashed names.
//!
//! ```
//! use tailwindcss_atomic::{atomicize_stylesheet, rewrite_class_string};
//!
//! let out = atomicize_stylesheet(".flex { display: flex }").unwrap();
//! assert!(out.changed);
//! assert!(out.class_map.contains_key("flex"));
//!
//! let rewritten = rewrite_class_string("flex items-center", &out.class_map);
//! assert!(rewritten.contains(out.class_map["flex"].as_str()));
//! ```

pub mod atomic;
pub mod classes;
pub mod html;
pub mod stats;
pub mod tailwind;

pub use atomic::{atomicize_stylesheet, is_utility_selector, AtomicOutput};
pub use stats::{class_string_stats, compute_atomic_stats, AtomicStats, ClassStringStats};
pub use classes::{
    lookup_mapped_class, normalize_utility_class_name, rewrite_class_string, split_class_tokens,
    unescape_css_class_name,
};
pub use html::rewrite_html_classes;
pub use tailwind::{core_utility_name, looks_like_tailwind_utility};
