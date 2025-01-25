# @takinprofit/sqlitex

A powerful, type-safe SQLite query builder and database wrapper for Node.js, featuring prepared statement caching, JSON column support, and SQL template literals.

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://badge.fury.io/js/@takinprofit%2Fsqlitex.svg)](https://www.npmjs.com/package/@takinprofit/sqlitex)

## Table of Contents

- [@takinprofit/sqlitex](#takinprofitsqlitex)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Installation](#installation)
  - [Quick Start](#quick-start)
  - [Core Concepts](#core-concepts)
    - [Database Connection](#database-connection)
    - [SQL Template Literals and SqlContext](#sql-template-literals-and-sqlcontext)
    - [Type Safety](#type-safety)
    - [JSON Support](#json-support)
  - [Advanced Usage](#advanced-usage)
    - [Query Building](#query-building)
    - [PRAGMA Configuration](#pragma-configuration)
    - [Statement Caching](#statement-caching)
    - [Backup and Restore](#backup-and-restore)
  - [API Reference](#api-reference)
  - [Contributing](#contributing)
  - [License](#license)

## Features

- 🔒 **Type-safe SQL template literals**
- 🚀 **Prepared statement caching**
- 📦 **First-class JSON column support**
- 🛠️ **Strong schema validation**
- 🔄 **SQL query composition**
- ⚙️ **Comprehensive PRAGMA configuration**
- 🌟 **Modern async/iterator support**

## Installation

```bash
npm install @takinprofit/sqlitex
```

## Quick Start

```typescript
import { DB } from '@takinprofit/sqlitex';

// Create a database connection
const db = new DB({
  location: ':memory:',
  environment: 'development'
});

// Define your table type
interface User {
  id: number;
  name: string;
  age: number;
  metadata: {
    preferences: {
      theme: string;
      notifications: boolean;
    };
  };
}

// Create a table
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    age INTEGER,
    metadata TEXT
  )
`);

// Insert with type safety and JSON support
const insert = db.sql<User>`
  INSERT INTO users (name, age, metadata)
  VALUES (${'$name'}, ${'$age'}, ${'$metadata->json'})
`;

insert.run({
  name: 'John Doe',
  age: 30,
  metadata: {
    preferences: {
      theme: 'dark',
      notifications: true
    }
  }
});

// Type-safe queries with automatic JSON parsing
const getUser = db.sql<{id: number}>`
  SELECT *, json_extract(metadata, '$') as metadata
  FROM users
  WHERE id = ${'$id'}
`;

const user = getUser.get({ id: 1 });
console.log(user.metadata.preferences.theme); // 'dark'
```

## Core Concepts

### Database Connection

SQLiteX provides comprehensive database configuration through the `DBOptions` interface:

```typescript
interface DBOptions {
  // Database file path or ":memory:" for in-memory database
  location?: string | ":memory:"

  // Statement cache configuration - boolean for defaults or detailed options
  statementCache?: boolean | {
    maxSize: number
    maxAge?: number
  }

  // SQLite PRAGMA settings
  pragma?: {
    journalMode?: "DELETE" | "TRUNCATE" | "PERSIST" | "MEMORY" | "WAL" | "OFF"
    synchronous?: "OFF" | "NORMAL" | "FULL" | "EXTRA"
    cacheSize?: number
    mmapSize?: number
    tempStore?: "DEFAULT" | "FILE" | "MEMORY"
    lockingMode?: "NORMAL" | "EXCLUSIVE"
    busyTimeout?: number
    foreignKeys?: boolean
    walAutocheckpoint?: number
    trustedSchema?: boolean
  }

  // Runtime environment affecting default PRAGMA settings
  environment?: "development" | "testing" | "production"

  // Custom logger implementation
  logger?: Logger

  // SQL formatting configuration
  format?: {
    indent?: string
    reservedWordCase?: "upper" | "lower"
    linesBetweenQueries?: number | "preserve"
  } | false
}

// Example usage with various options:
const db = new DB({
  location: 'path/to/db.sqlite',
  environment: 'production',
  statementCache: {
    maxSize: 100,
    maxAge: 3600000 // 1 hour
  },
  pragma: {
    journalMode: 'WAL',
    synchronous: 'NORMAL',
    foreignKeys: true,
    busyTimeout: 5000
  },
  format: {
    indent: '  ',
    reservedWordCase: 'upper',
    linesBetweenQueries: 1
  }
});
```

### SQL Template Literals and SqlContext

SQLiteX provides a powerful SQL template literal system combined with the `SqlContext` interface for type-safe query building:

```typescript
interface SqlContext<P extends DataRow> {
  // Column selection for SELECT statements
  cols?: (keyof P | FromJson<P> | ToJson<P>)[] | "*"

  // Values for INSERT statements
  values?: InsertOptions<P>

  // Column updates for UPDATE statements
  set?: SetOptions<P>

  // WHERE clause conditions
  where?: WhereClause<P>

  // ORDER BY configuration
  orderBy?: Partial<Record<keyof P, "ASC" | "DESC">>

  // LIMIT and OFFSET
  limit?: number
  offset?: number

  // RETURNING clause
  returning?: (keyof P)[] | "*"

  // Column definitions for CREATE TABLE
  columns?: Columns<P>
}

// Examples using SqlContext:

interface Post {
  id: number;
  title: string;
  userId: number;
  tags: string[];
  metadata: {
    views: number;
    lastModified: string;
  };
  status: 'draft' | 'published';
}

// INSERT with JSON and returning values
const createPost = db.sql<Post>`
  INSERT INTO posts
  ${{
    values: ['$title', '$userId', '$tags->json', '$metadata->json', '$status'],
    returning: ['id', 'created_at']
  }}
`;

// Complex SELECT with multiple conditions
const getPosts = db.sql<{
  userId: number,
  minViews: number,
  status: string
}>`
  SELECT ${{
    cols: ['id', 'title', 'metadata<-json', 'tags<-json']
  }}
  FROM posts
  ${{
    where: [
      'userId = $userId',
      'AND',
      'json_extract(metadata, "$.views") > $minViews',
      'AND',
      'status = $status'
    ],
    orderBy: {
      id: 'DESC'
    },
    limit: 10
  }}
`;

// Query Composition Examples

// Base query
let query = db.sql<{
  status: string,
  userId?: number,
  search?: string
}>`SELECT ${{
  cols: ['posts.*', 'metadata<-json', 'users.name as author']
}} FROM posts
LEFT JOIN users ON posts.userId = users.id`;

// Conditional WHERE clauses
if (params.status) {
  query = query.sql`${{
    where: 'status = $status'
  }}`;
}

// Add user filter if provided
if (params.userId) {
  query = query.sql`${{
    where: ['posts.userId = $userId']
  }}`;
}

// Add search condition if needed
if (params.search) {
  query = query.sql`${{
    where: ['title LIKE $search']
  }}`;
}

// Finalize with ordering and limits
query = query.sql`${{
  orderBy: {
    'posts.created_at': 'DESC'
  },
  limit: 20
}}`;

// UPDATE example with JSON modification
const updatePost = db.sql<Post & { newTags: string[] }>`
  UPDATE posts
  ${{
    set: [
      '$title',
      '$status',
      '$metadata->json',
      // Merge existing tags with new ones using JSON functions
      'tags = json_array(json_group_array(
        DISTINCT value)
      ) FROM (
        SELECT value FROM json_each($tags)
        UNION
        SELECT value FROM json_each($newTags)
      )'
    ],
    where: 'id = $id',
    returning: '*'
  }}
`;
```

### Type Safety

SQLiteX provides comprehensive type safety:

```typescript
interface Article {
  id: number;
  title: string;
  views: number;
  metadata: {
    authors: string[];
    categories: string[];
  };
}

// Column definitions are type-checked
const createTable = db.sql<Article>`
  CREATE TABLE articles ${
    columns: {
      id: 'INTEGER PRIMARY KEY',
      title: 'TEXT NOT NULL',
      views: 'INTEGER DEFAULT 0',
      metadata: 'TEXT'  // For JSON storage
    }
  }
`;

// Query parameters are type-checked
const updateViews = db.sql<Article>`
  UPDATE articles
  ${{
    set: ['$views'],
    where: 'id = $id',
    returning: ['views']
  }}
`;

// This will cause a type error
updateViews.run({
  id: 1,
  views: 'invalid'  // Type error: expected number
});
```

### JSON Support

First-class JSON column support with type safety:

```typescript
interface Product {
  id: number;
  name: string;
  specs: {
    dimensions: {
      width: number;
      height: number;
    };
    weight: number;
  };
  tags: string[];
}

// Store JSON data
const insertProduct = db.sql<Product>`
  INSERT INTO products
  ${{
    values: ['$name', '$specs->json', '$tags->json']
  }}
`;

// Query JSON data
const getProduct = db.sql<{id: number}>`
  SELECT
    name,
    json_extract(specs, '$.dimensions.width') as width,
    ${'$specs<-json'} as specs,
    ${'$tags<-json'} as tags
  FROM products
  WHERE id = ${'$id'}
`;
```

## Advanced Usage

### Query Building

SQLiteX provides a flexible query building API:

```typescript
interface Comment {
  id: number;
  postId: number;
  userId: number;
  content: string;
  metadata: {
    ip: string;
    userAgent: string;
  };
}

// Complex query composition
const queryComments = db.sql<{
  postId: number;
  userId?: number;
  limit?: number;
}>`
  SELECT
    c.*,
    ${'$metadata<-json'} as metadata
  FROM comments c
  ${({
    where: [
      'c.postId = $postId',
      ...(params.userId ? ['AND', 'c.userId = $userId'] : [])
    ],
    orderBy: { id: 'DESC' },
    limit: params.limit
  })}
`;
```

### PRAGMA Configuration

Fine-tune SQLite behavior with PRAGMA settings:

```typescript
const db = new DB({
  pragma: {
    // Write-Ahead Logging
    journalMode: 'WAL',

    // Synchronization mode
    synchronous: 'NORMAL',

    // Cache settings
    cacheSize: -64000,  // 64MB

    // Memory-mapped I/O
    mmapSize: 268435456,  // 256MB

    // Busy handler timeout
    busyTimeout: 5000,

    // Enforce foreign key constraints
    foreignKeys: true
  }
});
```

### Statement Caching

Optimize performance with statement caching:

```typescript
const db = new DB({
  statementCache: {
    maxSize: 1000,    // Maximum number of cached statements
    maxAge: 3600000  // Maximum age in milliseconds (1 hour)
  }
});

// Get cache statistics
const stats = db.getCacheStats();
console.log(stats);  // { hits: 150, misses: 10, size: 100, ... }

// Clear the cache if needed
db.clearStatementCache();
```

### Backup and Restore

Manage database backups:

```typescript
// Create a backup
db.backup('backup.sqlite');

// Restore from backup
db.restore('backup.sqlite');

// Clean shutdown
db.close({
  optimize: true,
  shrinkMemory: true,
  walCheckpoint: 'TRUNCATE'
});
```

## API Reference

For detailed API documentation, please visit [API Docs](link-to-api-docs).

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## License

This project is licensed under the BSD License - see the [LICENSE](LICENSE) file for details.

---

Made with ❤️ by [Takin Profit](https://github.com/takinprofit)
