use std::collections::HashMap;

use crate::classes::rewrite_class_string;

/// Before/after sizes for one `atomicize_stylesheet` run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AtomicStats {
    pub input_bytes: usize,
    pub output_bytes: usize,
    /// Distinct Tailwind utilities rewritten into the class map.
    pub utilities: usize,
    /// Distinct hashed atomic classes (shared declarations count once).
    pub atomic_rules: usize,
    /// Hash tokens assigned across all utilities (before sharing).
    pub declarations: usize,
    /// Hashes reused by more than one utility.
    pub shared_hashes: usize,
    pub elapsed_us: u64,
    pub changed: bool,
}

/// Byte length of a class string before and after rewrite.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassStringStats {
    pub before_bytes: usize,
    pub after_bytes: usize,
}

pub fn compute_atomic_stats(
    input: &str,
    class_map: &HashMap<String, String>,
    output_css: &str,
    changed: bool,
    elapsed_us: u64,
) -> AtomicStats {
    let mut hash_uses: HashMap<&str, usize> = HashMap::new();
    let mut declarations = 0usize;
    for hashes in class_map.values() {
        for hash in hashes.split_whitespace() {
            if hash.is_empty() {
                continue;
            }
            declarations += 1;
            *hash_uses.entry(hash).or_insert(0) += 1;
        }
    }

    AtomicStats {
        input_bytes: input.len(),
        output_bytes: output_css.len(),
        utilities: class_map.len(),
        atomic_rules: hash_uses.len(),
        declarations,
        shared_hashes: hash_uses.values().filter(|count| **count > 1).count(),
        elapsed_us,
        changed,
    }
}

pub fn class_string_stats(
    class_str: &str,
    class_map: &HashMap<String, String>,
) -> ClassStringStats {
    let after = rewrite_class_string(class_str, class_map);
    ClassStringStats {
        before_bytes: class_str.len(),
        after_bytes: after.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atomicize_stylesheet;

    #[test]
    fn measures_input_output_and_utility_counts() {
        let css = ".flex { display: flex } .p-4 { padding: 1rem }";
        let out = atomicize_stylesheet(css).unwrap();
        assert!(out.stats.changed);
        assert_eq!(out.stats.input_bytes, css.len());
        assert!(out.stats.output_bytes > 0);
        assert_eq!(out.stats.utilities, 2);
        assert_eq!(out.stats.atomic_rules, 2);
        assert_eq!(out.stats.declarations, 2);
        assert_eq!(out.stats.shared_hashes, 0);
    }

    #[test]
    fn splits_multi_declaration_utilities() {
        let css = ".p-4 { padding: 1rem; margin: 0 }";
        let out = atomicize_stylesheet(css).unwrap();
        assert_eq!(out.stats.utilities, 1);
        assert_eq!(out.stats.declarations, 2);
        assert_eq!(out.stats.atomic_rules, 2);
        assert_eq!(out.stats.shared_hashes, 0);
    }

    #[test]
    fn hashes_include_the_utility_name() {
        let css = ".flex { display: flex } .inline-flex { display: flex }";
        let out = atomicize_stylesheet(css).unwrap();
        assert_eq!(out.stats.utilities, 2);
        assert_eq!(out.stats.atomic_rules, 2);
        assert_eq!(out.stats.shared_hashes, 0);
        assert_ne!(out.class_map["flex"], out.class_map["inline-flex"]);
    }

    #[test]
    fn class_string_stats_tracks_rewrite_length() {
        let mut map = HashMap::new();
        map.insert("flex".into(), "_aaaaaa".into());
        let stats = class_string_stats("flex", &map);
        assert_eq!(stats.before_bytes, 4);
        assert_eq!(stats.after_bytes, 7);
    }
}
