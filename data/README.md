# Data

Current Congress snapshot in SQLite.

```bash
npm run data:import:congress
```

The importer discovers the latest official JSON export, validates it, and atomically updates `parlamento.sqlite`.
