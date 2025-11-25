/**
 * Server Mode File Browser Component
 *
 * Custom file browser for server-side file browsing.
 * This component is used in SERVER mode to replace native file dialogs.
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  Checkbox,
  Breadcrumbs,
  Link,
  Typography,
  Box,
  CircularProgress,
  TextField,
  InputAdornment,
  FormControlLabel
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import HomeIcon from '@mui/icons-material/Home';
import SearchIcon from '@mui/icons-material/Search';

/**
 * ServerFileBrowser Component
 *
 * Props:
 * - open: boolean - Whether the dialog is open
 * - onClose: function - Called when dialog is closed (no selection)
 * - onSelect: function - Called when files/folders are selected
 * - mode: 'file' | 'folder' - Selection mode
 * - multiple: boolean - Allow multiple selection (default: false)
 * - filters: array - File type filters (e.g., ['.csv', '.json'])
 * - title: string - Dialog title
 */
const ServerFileBrowser = ({
  open,
  onClose,
  onSelect,
  mode = 'file',
  multiple = false,
  filters = [],
  title = 'Select File'
}) => {
  const [currentPath, setCurrentPath] = useState('');
  const [selected, setSelected] = useState([]);
  const [fileData, setFileData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pathParts, setPathParts] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [allItems, setAllItems] = useState([]); // Store all items before filtering

  // Load directory contents from server
  const loadDirectory = async (path) => {
    setLoading(true);
    setSearchText(''); // Clear search when navigating
    try {
      const response = await fetch('http://localhost:8000/files/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path || '' })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to browse files');
      }

      const result = await response.json();
      setCurrentPath(result.path);

      // Parse path for breadcrumbs
      const parts = result.path.split('/').filter(p => p);
      setPathParts(parts);

      // Filter files by extension if filters provided
      let items = result.data;
      if (filters.length > 0 && mode === 'file') {
        items = items.filter(item => {
          if (item.type === 'folder') return true;
          return filters.some(ext => item.value.toLowerCase().endsWith(ext.toLowerCase()));
        });
      }

      // In folder mode, show folders but don't filter out files completely
      // (we still want to allow navigation through folders that contain subfolders)
      // The selection will be restricted to folders only

      setAllItems(items);
      setFileData(items);
    } catch (error) {
      console.error('Error loading directory:', error);
      alert(`Error loading directory: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Load home directory when dialog opens
  useEffect(() => {
    if (open) {
      loadDirectory('');
      setSelected([]);
    }
  }, [open]);

  // Filter items based on search text
  useEffect(() => {
    if (searchText.trim() === '') {
      setFileData(allItems);
    } else {
      const searchLower = searchText.toLowerCase();
      const filtered = allItems.filter(item =>
        item.value.toLowerCase().includes(searchLower)
      );
      setFileData(filtered);
    }
  }, [searchText, allItems]);

  // Handle double-click to navigate into folder
  const handleItemDoubleClick = (item) => {
    if (item.type === 'folder') {
      loadDirectory(item.id);
    }
  };

  // Handle single click to select/deselect
  const handleItemClick = (item) => {
    // In folder mode, only allow selecting folders
    if (mode === 'folder' && item.type !== 'folder') {
      return;
    }

    // In file mode, only allow selecting files
    if (mode === 'file' && item.type !== 'file') {
      return;
    }

    // Toggle selection
    if (multiple) {
      setSelected(prev =>
        prev.includes(item.id)
          ? prev.filter(id => id !== item.id)
          : [...prev, item.id]
      );
    } else {
      setSelected([item.id]);
    }
  };

  // Handle select all
  const handleSelectAll = (event) => {
    if (event.target.checked) {
      // Select all items that match the mode
      const selectableItems = fileData.filter(item => {
        if (mode === 'folder') return item.type === 'folder';
        if (mode === 'file') return item.type === 'file';
        return true;
      });
      setSelected(selectableItems.map(item => item.id));
    } else {
      setSelected([]);
    }
  };

  // Handle breadcrumb navigation
  const handleBreadcrumbClick = (index) => {
    if (index === -1) {
      // Home
      loadDirectory('');
    } else {
      // Navigate to path
      const newPath = '/' + pathParts.slice(0, index + 1).join('/');
      loadDirectory(newPath);
    }
  };

  // Handle OK button click
  const handleOk = () => {
    if (selected.length > 0) {
      onSelect(multiple ? selected : selected[0]);
    }
  };

  // Handle Cancel button click
  const handleCancel = () => {
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {/* Breadcrumb navigation */}
        <Box sx={{ mb: 2 }}>
          <Breadcrumbs aria-label="breadcrumb">
            <Link
              component="button"
              variant="body1"
              onClick={() => handleBreadcrumbClick(-1)}
              sx={{ display: 'flex', alignItems: 'center' }}
            >
              <HomeIcon sx={{ mr: 0.5 }} fontSize="small" />
              Home
            </Link>
            {pathParts.map((part, index) => (
              <Link
                key={index}
                component="button"
                variant="body1"
                onClick={() => handleBreadcrumbClick(index)}
              >
                {part}
              </Link>
            ))}
          </Breadcrumbs>
        </Box>

        {/* Search bar */}
        <TextField
          fullWidth
          size="small"
          placeholder="Search files and folders..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            )
          }}
          sx={{ mb: 2 }}
        />

        {/* Select all checkbox (only show for multiple selection) */}
        {multiple && (
          <Box sx={{ mb: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={
                    fileData.filter(item =>
                      mode === 'folder' ? item.type === 'folder' : item.type === 'file'
                    ).length > 0 &&
                    fileData.filter(item =>
                      mode === 'folder' ? item.type === 'folder' : item.type === 'file'
                    ).every(item => selected.includes(item.id))
                  }
                  indeterminate={
                    selected.length > 0 &&
                    !fileData.filter(item =>
                      mode === 'folder' ? item.type === 'folder' : item.type === 'file'
                    ).every(item => selected.includes(item.id))
                  }
                  onChange={handleSelectAll}
                />
              }
              label="Select All"
            />
          </Box>
        )}

        {/* File/folder list */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <List sx={{ maxHeight: 400, overflow: 'auto' }}>
            {fileData.length === 0 ? (
              <ListItem>
                <ListItemText primary="No items to display" />
              </ListItem>
            ) : (
              fileData.map((item) => {
                // Determine if this item can be selected based on mode
                const isSelectable =
                  (mode === 'folder' && item.type === 'folder') ||
                  (mode === 'file' && item.type === 'file');

                return (
                  <ListItem
                    key={item.id}
                    disablePadding
                    secondaryAction={
                      isSelectable && multiple ? (
                        <Checkbox
                          edge="end"
                          checked={selected.includes(item.id)}
                          onChange={() => handleItemClick(item)}
                        />
                      ) : null
                    }
                  >
                    <ListItemButton
                      onClick={() => handleItemClick(item)}
                      onDoubleClick={() => handleItemDoubleClick(item)}
                      selected={selected.includes(item.id)}
                    >
                      <ListItemIcon>
                        {item.type === 'folder' ? (
                          <FolderIcon color="primary" />
                        ) : (
                          <InsertDriveFileIcon />
                        )}
                      </ListItemIcon>
                      <ListItemText
                        primary={item.value}
                      // secondary={
                      //   item.type === 'file' && item.size
                      //     ? `${(item.size / 1024).toFixed(1)} KB`
                      //     : item.type === 'folder'
                      //     ? 'Double-click to open'
                      //     : null
                      // }
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })
            )}
          </List>
        )}

        {/* Current path display */}
        <Box sx={{ mt: 2, p: 1, bgcolor: 'grey.100', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Current path: {currentPath || '/'}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel}>Cancel</Button>
        <Button
          onClick={handleOk}
          variant="contained"
          disabled={selected.length === 0}
        >
          Select
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ServerFileBrowser;
