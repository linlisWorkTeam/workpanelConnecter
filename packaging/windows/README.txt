WorkPanelConnecter portable server
==================================

1. Copy config\relay.example.json to config\relay.json.
2. Replace all example URLs, usernames, passwords and tokens.
3. Start WorkPanelConnecter.exe.

The executable reads config\relay.json by default. You may instead set
CONNECTER_RELAY_CONFIG to an absolute JSON path. Runtime SQLite data is written
to the configured db.path. Keep configuration, credentials and data outside Git.

WorkPet is distributed separately as WorkPet_<version>_x64-setup.exe.
WorkPet runs on a user's Windows desktop; this portable server runs at a Site.

This build is currently unsigned. Windows SmartScreen may show an unknown
publisher warning until project code signing is configured.
