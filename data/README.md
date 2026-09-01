# Data

Current Congress snapshot in SQLite.

```bash
npm run data:import:congress
npm run data:import:photos
npm run data:import:initiatives
```

The Congress importer updates members, parties, and groups. The photo importer adds conservatively matched Wikimedia Commons images with attribution and license metadata. The initiatives importer snapshots current-legislature bills and legislative proposals from the three official Congress JSON exports.
