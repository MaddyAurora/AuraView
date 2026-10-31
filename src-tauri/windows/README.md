# Windows installer templates

`installer.nsi` and `main.wxs` are based on the Tauri CLI 2.11.4 templates. They are customized so newly created application shortcuts use an icon separate from the executable: the NSIS installer uses the bundled `auraview-purple-globe-2026.ico`, and the MSI uses its `ProductIcon` resource for the desktop shortcut. Keep these templates in sync with Tauri when upgrading the CLI. If the app icon changes, use a new resource filename in both the bundle configuration and NSIS template to avoid stale Windows icon caches.

Tauri's existing shortcut and update-mode behavior is otherwise unchanged. In particular, an NSIS update that preserves existing shortcuts does not rewrite their icon locations.
