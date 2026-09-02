mod atomic;
mod classes;
mod html;

use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
pub struct AtomicResult {
    /// Mapa de clase Tailwind -> lista de clases atómicas ("p-4" -> "_x1a _x2b")
    pub class_map: std::collections::HashMap<String, String>,
    /// Lista deduplicada de reglas CSS atómicas a emitir.
    pub css_rules: Vec<String>,
    /// Stylesheet completo tras atomicizar (preserva :root, @media, skins, :hover).
    pub css: String,
    pub changed: bool,
}

fn js_class_map(value: JsValue) -> std::collections::HashMap<String, String> {
    serde_wasm_bindgen::from_value(value).unwrap_or_default()
}

#[wasm_bindgen]
pub fn process_tailwind_css(raw_css: &str) -> Result<JsValue, JsValue> {
    let output =
        atomic::atomicize_stylesheet(raw_css).map_err(|error| JsValue::from_str(&error))?;

    let result = AtomicResult {
        class_map: output.class_map,
        css_rules: output.css_rules,
        css: output.css,
        changed: output.changed,
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn rewrite_class_string(class_str: &str, class_map: JsValue) -> String {
    classes::rewrite_class_string(class_str, &js_class_map(class_map))
}

#[wasm_bindgen]
pub fn rewrite_html_classes(html: &str, class_map: JsValue) -> String {
    html::rewrite_html_classes(html, &js_class_map(class_map))
}
