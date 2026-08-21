window.__ModuleLoader__.load({
  id: 'dsh-file-picker',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const CHANNEL = '/file-picker'
    const MAX_SELECTION = 32
    const SEARCH_DELAY_MS = 150

    function createStore() {
      let state = { open: false, sessionId: null, inputActions: null, count: 0 }
      const listeners = new Set()
      const emit = () => listeners.forEach((listener) => listener())
      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        open(sessionId, inputActions) {
          state = { ...state, open: true, sessionId, inputActions }
          emit()
        },
        close() {
          state = { ...state, open: false, inputActions: null }
          emit()
        },
        setCount(count) {
          state = { ...state, count }
          emit()
        },
      }
    }

    function useStore(store) {
      return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    }

    function useDirectory(connection, open) {
      const [listing, setListing] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [target, setTarget] = React.useState({ path: undefined, query: '' })
      const latestRequest = React.useRef(0)

      React.useEffect(() => {
        if (!open) {
          latestRequest.current += 1
          setLoading(false)
          setTarget((current) => current.query.length === 0 ? current : { ...current, query: '' })
          return undefined
        }

        const requestId = latestRequest.current + 1
        latestRequest.current = requestId
        const hasQuery = target.query.trim().length > 0
        const timer = setTimeout(async () => {
          setLoading(true)
          setError(null)
          try {
            const payload = {}
            if (target.path !== undefined) payload.path = target.path
            if (hasQuery) payload.query = target.query
            const result = await connection.rpc.call(CHANNEL, 'list', payload)
            if (!result.ok) throw new Error(result.error.message)
            if (latestRequest.current === requestId) setListing(result.value)
          } catch (cause) {
            if (latestRequest.current === requestId) {
              setError(cause instanceof Error ? cause.message : 'Unable to browse this folder.')
            }
          } finally {
            if (latestRequest.current === requestId) setLoading(false)
          }
        }, hasQuery ? SEARCH_DELAY_MS : 0)

        return () => clearTimeout(timer)
      }, [connection, open, target.path, target.query])

      const navigate = React.useCallback((path) => {
        setTarget({ path, query: '' })
      }, [])
      const setQuery = React.useCallback((query) => {
        setTarget((current) => ({ ...current, query }))
      }, [])

      return { listing, error, loading, navigate, query: target.query, setQuery }
    }

    function FilePickerButton(props) {
      const store = props.store
      const state = useStore(store)
      const count = state.sessionId === props.session.sessionId ? state.count : 0
      return h('button', {
        type: 'button',
        title: 'Select files and folders for model context',
        'aria-label': 'Select files and folders for model context',
        onClick: () => store.open(props.session.sessionId, props.inputActions),
        style: {
          border: 0,
          borderRadius: 8,
          background: 'transparent',
          color: 'var(--dsw-alias-label-secondary, #6b7280)',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: '28px',
          minWidth: 32,
          padding: '0 6px',
        },
      }, count > 0 ? `📁 ${count}` : '📁')
    }

    function FilePickerOverlay(props) {
      const state = useStore(props.store)
      const { listing, error, loading, navigate, query, setQuery } = useDirectory(props.connection, state.open)
      const [selected, setSelected] = React.useState(() => new Set())
      const [submitting, setSubmitting] = React.useState(false)
      const [actionError, setActionError] = React.useState(null)

      React.useEffect(() => {
        if (!state.open) {
          setSelected(new Set())
          setActionError(null)
        }
      }, [state.open])

      if (!state.open || state.sessionId === null) return null

      const toggle = (path) => {
        const next = new Set(selected)
        if (next.has(path)) {
          next.delete(path)
          setActionError(null)
        } else if (next.size >= MAX_SELECTION) {
          setActionError(`You can select at most ${MAX_SELECTION} files and folders.`)
          return
        } else {
          next.add(path)
          setActionError(null)
        }
        setSelected(next)
      }

      const applySelection = async (paths) => {
        setSubmitting(true)
        setActionError(null)
        try {
          const result = await props.connection.rpc.call(CHANNEL, 'select', {
            sessionId: state.sessionId,
            paths,
          })
          if (!result.ok) throw new Error(result.error.message)
          props.store.setCount(result.value.paths.length)
          state.inputActions?.notify?.('info', result.value.paths.length === 0
            ? 'Cleared selected paths for this conversation.'
            : `Added ${result.value.paths.length} selected item${result.value.paths.length === 1 ? '' : 's'} to model context.`)
          props.store.close()
        } catch (cause) {
          setActionError(cause instanceof Error ? cause.message : 'Unable to update selected paths.')
        } finally {
          setSubmitting(false)
        }
      }

      const entries = listing?.entries ?? []
      const searchActive = query.trim().length > 0
      const selectionFull = selected.size >= MAX_SELECTION
      const currentDirectorySelected = listing !== null && selected.has(listing.path)
      return h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Select files and folders',
        style: {
          position: 'fixed',
          zIndex: 10000,
          inset: 0,
          pointerEvents: 'auto',
          background: 'rgba(0, 0, 0, 0.42)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        },
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) props.store.close()
        },
      }, h('div', {
        style: {
          background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
          color: 'var(--dsw-alias-label-primary, #111827)',
          borderRadius: 16,
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.28)',
          display: 'flex',
          flexDirection: 'column',
          width: 'min(760px, 100%)',
          height: 'min(640px, calc(100vh - 48px))',
          overflow: 'hidden',
        },
      }, [
        h('div', { key: 'header', style: { padding: '18px 20px 12px', borderBottom: '1px solid var(--dsw-alias-border-light, #e5e7eb)' } }, [
          h('div', { key: 'title', style: { fontSize: 18, fontWeight: 600 } }, 'Select files and folders for context'),
          h('div', { key: 'description', style: { color: 'var(--dsw-alias-label-secondary, #6b7280)', fontSize: 13, marginTop: 4 } }, 'Search the current folder or browse the DSH host. Applying replaces the current conversation selection.'),
        ]),
        h('div', { key: 'pathbar', style: { display: 'flex', gap: 8, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--dsw-alias-border-light, #e5e7eb)' } }, [
          h('button', { key: 'home', type: 'button', disabled: loading || listing === null, onClick: () => navigate(listing?.home), style: buttonStyle }, 'Home'),
          h('button', { key: 'up', type: 'button', disabled: loading || listing?.parent === null || listing === null, onClick: () => navigate(listing.parent), style: buttonStyle }, 'Up'),
          h('code', { key: 'path', title: listing?.path, style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 } }, listing?.path ?? 'Loading…'),
          h('label', { key: 'current', title: 'Select the folder shown in the path bar', style: { alignItems: 'center', display: 'flex', fontSize: 12, gap: 5, whiteSpace: 'nowrap' } }, [
            h('input', {
              key: 'check',
              type: 'checkbox',
              checked: currentDirectorySelected,
              disabled: loading || listing === null || (!currentDirectorySelected && selectionFull),
              onChange: () => listing !== null && toggle(listing.path),
            }),
            'Select this folder',
          ]),
        ]),
        h('div', { key: 'searchbar', style: { padding: '10px 20px', borderBottom: '1px solid var(--dsw-alias-border-light, #e5e7eb)' } }, [
          h('input', {
            key: 'search',
            type: 'search',
            value: query,
            maxLength: 256,
            disabled: listing === null,
            placeholder: 'Search this folder…',
            'aria-label': 'Search this folder',
            onChange: (event) => setQuery(event.target.value),
            style: searchInputStyle,
          }),
        ]),
        h('div', { key: 'content', style: { flex: 1, overflow: 'auto', padding: 12 } }, [
          loading ? h('div', { key: 'loading', style: emptyStyle }, searchActive ? 'Searching…' : 'Loading files and folders…') : null,
          error ? h('div', { key: 'error', style: { ...emptyStyle, color: '#b42318' } }, error) : null,
          !loading && !error && listing?.truncated ? h('div', { key: 'truncated', style: { ...emptyStyle, padding: 8 } }, searchActive ? 'Search results are truncated to the first 500 matches.' : 'This folder is truncated to the first 500 entries.') : null,
          !loading && !error && listing !== null && entries.length === 0 ? h('div', { key: 'empty', style: emptyStyle }, searchActive ? 'No matching files or folders.' : 'No entries in this folder.') : null,
          !loading && !error && entries.map((entry) => {
            const isDirectory = entry.kind === 'directory'
            const isFile = entry.kind === 'file'
            const isSelectable = isDirectory || isFile
            const isSelected = selected.has(entry.path)
            return h('div', { key: entry.path, style: rowStyle }, [
              isSelectable ? h('input', {
                key: 'check',
                type: 'checkbox',
                checked: isSelected,
                disabled: !isSelected && selectionFull,
                onChange: () => toggle(entry.path),
                style: { margin: '0 2px 0 0' },
                'aria-label': `Select ${entry.name}`,
              }) : h('span', { key: 'spacer', style: { width: 18 } }),
              h('button', {
                key: 'entry',
                type: 'button',
                disabled: !isSelectable,
                onClick: () => isDirectory ? navigate(entry.path) : toggle(entry.path),
                style: { ...entryButtonStyle, opacity: entry.kind === 'other' ? 0.5 : 1 },
              }, `${isDirectory ? '📂' : isFile ? '📄' : '◌'} ${entry.name}`),
            ])
          }),
        ]),
        h('div', { key: 'footer', style: { padding: '12px 20px', borderTop: '1px solid var(--dsw-alias-border-light, #e5e7eb)', display: 'flex', alignItems: 'center', gap: 8 } }, [
          actionError ? h('span', { key: 'action-error', style: { color: '#b42318', fontSize: 13, flex: 1 } }, actionError) : h('span', { key: 'count', style: { color: 'var(--dsw-alias-label-secondary, #6b7280)', fontSize: 13, flex: 1 } }, `${selected.size} item${selected.size === 1 ? '' : 's'} selected (max ${MAX_SELECTION})`),
          h('button', { key: 'clear', type: 'button', disabled: submitting, onClick: () => applySelection([]), style: buttonStyle }, 'Clear'),
          h('button', { key: 'cancel', type: 'button', disabled: submitting, onClick: () => props.store.close(), style: buttonStyle }, 'Cancel'),
          h('button', { key: 'apply', type: 'button', disabled: submitting || selected.size === 0, onClick: () => applySelection([...selected]), style: { ...buttonStyle, background: '#2563eb', borderColor: '#2563eb', color: '#ffffff' } }, submitting ? 'Applying…' : 'Apply'),
        ]),
      ]))
    }

    const buttonStyle = {
      border: '1px solid var(--dsw-alias-border-light, #d1d5db)',
      borderRadius: 8,
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      font: 'inherit',
      fontSize: 13,
      padding: '6px 10px',
    }
    const searchInputStyle = {
      background: 'transparent',
      border: '1px solid var(--dsw-alias-border-light, #d1d5db)',
      borderRadius: 8,
      color: 'inherit',
      font: 'inherit',
      fontSize: 13,
      outline: 'none',
      padding: '8px 10px',
      width: '100%',
    }
    const entryButtonStyle = {
      border: 0,
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      font: 'inherit',
      overflow: 'hidden',
      padding: '6px 8px',
      textAlign: 'left',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      width: '100%',
    }
    const rowStyle = { alignItems: 'center', borderRadius: 8, display: 'flex', minHeight: 32 }
    const emptyStyle = { color: 'var(--dsw-alias-label-secondary, #6b7280)', padding: 24, textAlign: 'center' }

    const inject = ['slots', 'connection']

    function apply(ctx) {
      const store = createStore()
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'dsh-file-picker:button',
        order: 50,
      }, (props) => h(FilePickerButton, { ...props, store })))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-file-picker:overlay',
        order: 50,
      }, () => h(FilePickerOverlay, { connection: ctx.connection, store })))
    }

    return { apply, inject }
  },
})
