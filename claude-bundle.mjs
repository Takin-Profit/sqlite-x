// Copyright 2025 Takin Profit. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import * as fs from "node:fs/promises"
import * as path from "node:path"

class ProjectBundler {
	constructor(config) {
		this.config = config
		this.defaultIgnorePatterns = [
			"node_modules",
			".git",
			"dist",
			"build",
			".DS_Store",
			"coverage",
			".next",
			"*.log",
		]
	}

	// Extensions that should be treated as text files
	textExtensions = new Set([
		".ts",
		".tsx",
		".js",
		".jsx",
		".json",
		".md",
		".css",
		".scss",
		".less",
		".html",
		".svg",
		".yml",
		".yaml",
		".txt",
		".env",
		".gitignore",
		".eslintrc",
		".prettierrc",
		".editorconfig",
	])

	// Map file extensions to languages
	languageMap = {
		".ts": "typescript",
		".tsx": "typescript",
		".js": "javascript",
		".jsx": "javascript",
		".json": "json",
		".md": "markdown",
		".css": "css",
		".scss": "scss",
		".less": "less",
		".html": "html",
		".svg": "svg",
		".yml": "yaml",
		".yaml": "yaml",
	}

	// Map extensions to MIME types
	mimeTypeMap = {
		".ts": "application/typescript",
		".tsx": "application/typescript",
		".js": "application/javascript",
		".jsx": "application/javascript",
		".json": "application/json",
		".md": "text/markdown",
		".css": "text/css",
		".scss": "text/x-scss",
		".less": "text/x-less",
		".html": "text/html",
		".svg": "image/svg+xml",
		".yml": "application/yaml",
		".yaml": "application/yaml",
		".txt": "text/plain",
	}

	shouldIgnore(relativePath, ignorePatterns) {
		const normalizedPath = relativePath.replace(/\\/g, "/")
		const fileName = path.basename(normalizedPath)
		const pathParts = normalizedPath.split("/")

		for (const pattern of ignorePatterns) {
			// Handle wildcard patterns (e.g., *.log)
			if (pattern.includes("*")) {
				const regex = new RegExp(
					`^${pattern.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`
				)
				if (regex.test(fileName)) {
					return true
				}
			}

			// Handle exact directory matches
			if (pathParts.includes(pattern)) {
				return true
			}

			// Handle user-specified directory paths (e.g., src/data)
			if (
				normalizedPath.startsWith(`${pattern}/`) ||
				normalizedPath === pattern
			) {
				return true
			}
		}

		return false
	}

	async getAllFiles(baseDir, currentDir, ignorePatterns) {
		const entries = await fs.readdir(currentDir, { withFileTypes: true })
		const files = []

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name)
			const relativePath = path.relative(baseDir, fullPath)

			if (this.shouldIgnore(relativePath, ignorePatterns)) {
				continue
			}

			if (entry.isDirectory()) {
				files.push(
					...(await this.getAllFiles(baseDir, fullPath, ignorePatterns))
				)
			} else {
				files.push(fullPath)
			}
		}

		return files
	}

	getFileMetadata(filePath, stats) {
		const extension = path.extname(filePath)
		return {
			size: stats.size,
			modified: stats.mtimeMs,
			extension,
			mimeType: this.mimeTypeMap[extension] || "application/octet-stream",
			language: this.languageMap[extension],
			encoding: this.textExtensions.has(extension) ? "utf8" : "base64",
		}
	}

	async readFileContent(filePath, encoding) {
		const content = await fs.readFile(filePath)
		return encoding === "utf8"
			? content.toString("utf8")
			: content.toString("base64")
	}

	async bundleSingleProject(projectConfig) {
		const { inputDir, outputFile, ignore = [] } = projectConfig
		const allIgnorePatterns = [...this.defaultIgnorePatterns, ...ignore]

		const bundle = {
			formatVersion: "1.0",
			bundleType: "source-code",
			bundledAt: new Date().toISOString(),
			projectRoot: path.basename(inputDir),
			files: {},
		}

		const baseDir = path.resolve(inputDir)
		const files = await this.getAllFiles(baseDir, baseDir, allIgnorePatterns)

		for (const filePath of files) {
			const relativePath = path.relative(baseDir, filePath)
			const stats = await fs.stat(filePath)
			const metadata = this.getFileMetadata(filePath, stats)
			const content = await this.readFileContent(filePath, metadata.encoding)

			bundle.files[relativePath] = {
				content,
				metadata,
			}
		}

		const outputDir = path.dirname(outputFile)
		await fs.mkdir(outputDir, { recursive: true })
		await fs.writeFile(outputFile, JSON.stringify(bundle, null, 2))
		console.log(`Project ${inputDir} bundled successfully to ${outputFile}`)
		console.log(`Total files bundled: ${Object.keys(bundle.files).length}`)
	}

	async bundleProjects() {
		const results = await Promise.allSettled(
			this.config.projects.map(project => this.bundleSingleProject(project))
		)

		results.forEach((result, index) => {
			if (result.status === "rejected") {
				console.error(
					`Failed to bundle project ${this.config.projects[index].inputDir}:`,
					result.reason
				)
			}
		})
	}
}

const config = {
	projects: [
		{
			inputDir: "./src",
			outputFile: "./db.claude.json",
			// ignore: ["src/data"],
		},
	],
}

try {
	const bundler = new ProjectBundler(config)
	await bundler.bundleProjects()
} catch (error) {
	console.error("Failed to bundle server project:", error)
	process.exit(1)
}
