"use strict";

module.exports = function tailwindAtomicLoader(source) {
	const callback = this.async();
	const {transformAtomicSource} = require("./dist/index.js");

	Promise.resolve(transformAtomicSource(source, this.resourcePath))
		.then((result) => {
			callback(null, result && result.code != null ? result.code : source);
		})
		.catch((error) => {
			callback(error);
		});
};
