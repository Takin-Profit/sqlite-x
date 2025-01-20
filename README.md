# @takinprofit/sqlite-x

A modern type-safe SQLite wrapper for Node.js/TypeScript.

## Installation

```bash
npm install @takinprofit/sqlite-x
```

## Features

- 🚀 Type-safe query building
- 🔒 Built-in statement caching
- 📦 Backup and restore functionality
- ⚡ Modern ES modules support
- 🛡️ Strict type checking
- 🎯 Native Node.js SQLite bindings

## Usage

### Database Setup

```typescript
import { DB } from '@takinprofit/sqlite-x';
import { ConsoleLogger, LogLevel } from '@takinprofit/sqlite-x/logger';

const db = new DB({
  location: 'path/to/database.db',
  environment: 'production',
  logger: new ConsoleLogger(LogLevel.ERROR),
});
```

### Inserting Data

```typescript
const insertUser = db.mutate<{ name: string; age: number; email: string }>(
  ({ sql }) => sql`
    INSERT INTO users (name, age, email)
    VALUES (${"name"}, ${"age"}, ${"email"})
  `
);

const result = insertUser({
  name: "John",
  age: 30,
  email: "john@example.com"
});

// Returns: { changes: 1, lastInsertRowid: number }
```

### Querying Data

```typescript
const getUsers = db.query<{ minAge: number }>(
  ({ sql }) => sql`
    SELECT name, age, email
    FROM users
    WHERE age >= ${"minAge"}
  `
);

const users = getUsers<Array<{ name: string; age: number; email: string }>>({
  minAge: 28
});
```

### Complex Queries

```typescript
const getUsers = db.query<{ minAge: number; nameLike: string }>(
  ({ sql }) => sql`
    SELECT * FROM users
    WHERE age >= ${"minAge"}
    AND name LIKE ${"nameLike"}
  `
);

const results = getUsers<Array<{ name: string; age: number }>>({
  minAge: 25,
  nameLike: "J%"
});
```

### Updating Data

```typescript
const updateUser = db.mutate<{ id: number | bigint; newAge: number }>(
  ({ sql }) => sql`
    UPDATE users
    SET age = ${"newAge"}
    WHERE id = ${"id"}
  `
);

const result = updateUser({
  id: userId,
  newAge: 31
});
```

### Deleting Data

```typescript
const deleteUser = db.mutate<{ id: number | bigint }>(
  ({ sql }) => sql`
    DELETE FROM users
    WHERE id = ${"id"}
  `
);

const result = deleteUser({ id: userId });
```

### Backup and Restore

```typescript
// Create backup
db.backup('path/to/backup.db');

// Restore from backup
db.restore('path/to/backup.db');
```

### Statement Caching

```typescript
const db = new DB({
  location: "database.db",
  statementCache: { maxSize: 10 }
});

// Cache statistics
const stats = db.getCacheStats();
db.clearStatementCache();
```

## Error Handling

The library throws `NodeSqliteError` for all SQLite-related errors:

```typescript
try {
  // Duplicate email
  insertUser({
    name: "Jane",
    age: 25,
    email: "existing@email.com"
  });
} catch (error) {
  if (error instanceof NodeSqliteError) {
    console.error("SQLite error:", error.message);
    console.error("Code:", error.getPrimaryResultCode());
  }
}
```

## Configuration

```typescript
interface DBConfig {
  location: string;
  environment?: 'production' | 'development' | 'testing';
  logger?: Logger;
  statementCache?: { maxSize: number };
}
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build project
npm run build
```

## License

ISC

## Author

Takin Profit
