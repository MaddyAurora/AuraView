import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BookmarkEditorWindow } from './components/BookmarkEditorWindow';
import { BookmarkFolderWindow } from './components/BookmarkFolderWindow';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {window.location.hash === '#bookmark-editor' ? <BookmarkEditorWindow /> : window.location.hash === '#bookmark-folder' ? <BookmarkFolderWindow /> : <App />}
  </React.StrictMode>
);
