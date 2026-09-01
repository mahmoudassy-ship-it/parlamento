# Data

Current Congress snapshot in SQLite.

```bash
npm run data:import:congress
npm run data:import:photos
npm run data:import:initiatives
npm run data:import:votes
```

The Congress importer updates members, parties, and groups. The photo importer adds conservatively matched Wikimedia Commons images with attribution and license metadata. The initiatives importer snapshots current-legislature bills and legislative proposals. The votes importer stores every XV-legislature plenary roll call and each deputy's reported choice.
