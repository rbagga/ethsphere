import { useEffect, useState, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Sphere } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three';
import { useState as useReactState } from 'react';
import { formatEther } from 'ethers';
import { CSSTransition, TransitionGroup } from 'react-transition-group';
import { useRef as useReactRef, createRef } from 'react';
import * as Tone from 'tone';
import config from './config.js';

// List of notes for one octave (C4 to B4)
const PIANO_NOTES = [
  'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4'
];

// Helper to get a point on the sphere for an address
function addressToSphereCoords(address, radius = 1) {
  const hash = parseInt(address.slice(2, 10), 16)
  const theta = (hash % 1000) / 1000 * 2 * Math.PI
  const phi = ((hash >> 10) % 1000) / 1000 * Math.PI
  return [
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi)
  ]
}

// Helper to get a random color for a transaction hash
function hashToColor(hash) {
  // Simple hash to color: take first 6 hex digits after 0x
  if (!hash) return '#fff';
  let n = 0;
  for (let i = 0; i < hash.length; ++i) n = (n * 31 + hash.charCodeAt(i)) & 0xffffff;
  return `#${n.toString(16).padStart(6, '0')}`;
}

// Helper to generate a random color
function randomColor() {
  // Generate a random hex color
  return `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
}

// Helper to detect and render Ethereum addresses and transaction hashes as clickable links
function renderEtherscanLink(value) {
  if (!value || typeof value !== 'string') return value;
  
  const str = String(value);
  
  // Check if it's an Ethereum address (0x followed by 40 hex characters)
  const addressRegex = /^0x[a-fA-F0-9]{40}$/;
  if (addressRegex.test(str)) {
    return (
      <a
        href={`https://etherscan.io/address/${str}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: '#4fd1c5',
          textDecoration: 'none',
          borderBottom: '1px dashed #4fd1c5',
        }}
        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
        title={`View address on Etherscan: ${str}`}
      >
        {str}
      </a>
    );
  }
  
  // Check if it's a transaction hash (0x followed by 64 hex characters)
  const txHashRegex = /^0x[a-fA-F0-9]{64}$/;
  if (txHashRegex.test(str)) {
    return (
      <a
        href={`https://etherscan.io/tx/${str}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: '#ffa500',
          textDecoration: 'none',
          borderBottom: '1px dashed #ffa500',
        }}
        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
        title={`View transaction on Etherscan: ${str}`}
      >
        {str}
      </a>
    );
  }
  
  return str;
}

// Animated twinkle point
function TwinklePoint({ pos, duration }) {
  const meshRef = useRef()
  const start = useRef(Date.now())
  useFrame(() => {
    if (!meshRef.current) return
    const elapsed = (Date.now() - start.current) / duration
    // Animate scale: pop in and out
    const scale = 1 + 1.5 * Math.sin(Math.PI * Math.min(elapsed, 1))
    meshRef.current.scale.set(scale, scale, scale)
    // Animate emissive intensity: peak at middle
    meshRef.current.material.emissiveIntensity = 1 + 2 * Math.sin(Math.PI * Math.min(elapsed, 1))
  })
  return (
    <mesh ref={meshRef} position={pos}>
      <sphereGeometry args={[0.01, 16, 16]} />
      <meshStandardMaterial color="#fff700" emissive="#fff700" emissiveIntensity={1} />
    </mesh>
  )
}

// Helper to render a cylinder between two points
function CylinderBetween({ start, end, color }) {
  const ref = useRef();
  // Calculate midpoint, direction, and length
  const startVec = new THREE.Vector3(...start);
  const endVec = new THREE.Vector3(...end);
  const mid = startVec.clone().add(endVec).multiplyScalar(0.5);
  const dir = endVec.clone().sub(startVec);
  const length = dir.length();
  // Cylinder points up Y by default, so compute quaternion
  const orientation = new THREE.Quaternion();
  orientation.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize()
  );
  return (
    <mesh ref={ref} position={mid.toArray()} quaternion={orientation}>
      <cylinderGeometry args={[0.006, 0.006, length, 12]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} />
    </mesh>
  );
}

function App() {
  const [pendingTxs, setPendingTxs] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [points, setPoints] = useState([]) // {address, pos}
  const [visualized, setVisualized] = useState([]) // {from, to, fromPos, toPos, hash, color}
  const [animating, setAnimating] = useState(false)
  const [twinkle, setTwinkle] = useState(null) // {address, pos, type: 'from'|'to'}
  const [trail, setTrail] = useState(null) // {fromPos, toPos, color, progress: 0-1}
  const [selectedAddress, setSelectedAddress] = useState(null) // NEW: selected address for filtering
  const queueRef = useRef([])

  // Mobile detection and responsive state
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Lock to ensure only one transaction is processed at a time
  const processingRef = useRef(false);
  // Buffer for new transactions fetched during animation
  const [bufferedTxs, setBufferedTxs] = useState([]);

  // Popup state for hovered address
  const [hoveredAddress, setHoveredAddress] = useReactState(null);
  const [popupPos, setPopupPos] = useReactState({ x: 0, y: 0 });
  // Popup state for hovered transaction
  const [hoveredTx, setHoveredTx] = useReactState(null); // { hash, amount }
  const [txPopupPos, setTxPopupPos] = useReactState({ x: 0, y: 0 });

  // Sidebar: robust, minimal resizable/collapsible implementation
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(350);
  const minSidebarWidth = 180;
  const maxSidebarWidth = 900;
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // Transaction animation speed (ms)
  const [txSpeed, setTxSpeed] = useState(1200); // default 1200ms

  // Draggable slider position
  const [sliderPos, setSliderPos] = useState({ x: window.innerWidth / 2 - 200, y: window.innerHeight - 100 });
  const sliderDragging = useRef(false);
  const [sliderDraggingState, setSliderDraggingState] = useState(false); // NEW: state for dragging
  const sliderDragOffset = useRef({ x: 0, y: 0 });

  // Piano arpeggio setup
  const [arpeggio, setArpeggio] = useState(['C4', 'E4', 'G4', 'C5']);
  const samplerRef = useRef();
  useEffect(() => {
    samplerRef.current = new Tone.Sampler({
      urls: {
        C4: 'C4.mp3',
        E4: 'E4.mp3',
        G4: 'G4.mp3',
        C5: 'C5.mp3',
      },
      baseUrl: '/',
      release: 2, // Longer release for pedal effect
      onload: () => console.log('Piano samples loaded'),
    }).toDestination();
  }, []);

  useEffect(() => {
    function onMouseMove(e) {
      if (sliderDragging.current) {
        let newX = e.clientX - sliderDragOffset.current.x;
        let newY = e.clientY - sliderDragOffset.current.y;
        // Clamp to window bounds
        newX = Math.max(0, Math.min(window.innerWidth - 340, newX));
        newY = Math.max(0, Math.min(window.innerHeight - 70, newY));
        setSliderPos({ x: newX, y: newY });
      }
    }
    function onMouseUp() {
      sliderDragging.current = false;
      setSliderDraggingState(false); // NEW: update state
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
    if (sliderDraggingState) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [sliderDraggingState]); // Depend on state

  useEffect(() => {
    function onMouseMove(e) {
      if (dragging.current) {
        let newWidth = dragStartWidth.current + (e.clientX - dragStartX.current);
        newWidth = Math.max(minSidebarWidth, Math.min(maxSidebarWidth, newWidth));
        console.log('Dragging sidebar, newWidth:', newWidth);
        setSidebarWidth(newWidth);
      }
    }
    function onMouseUp() {
      dragging.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
    if (dragging.current) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [minSidebarWidth, maxSidebarWidth]);

  useEffect(() => {
    function onMouseMove(e) {
      if (sliderDragging.current) {
        let newX = e.clientX - sliderDragOffset.current.x;
        let newY = e.clientY - sliderDragOffset.current.y;
        // Clamp to window bounds
        newX = Math.max(0, Math.min(window.innerWidth - 340, newX));
        newY = Math.max(0, Math.min(window.innerHeight - 70, newY));
        setSliderPos({ x: newX, y: newY });
      }
    }
    function onMouseUp() {
      sliderDragging.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
    if (sliderDragging.current) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Fetch pending queue
  useEffect(() => {
    async function fetchPending() {
      try {
        const res = await fetch(`${config.API_BASE_URL}/pending-queue`)
        const data = await res.json()
        // If animating, buffer new transactions
        if (processingRef.current) {
          setBufferedTxs(prev => {
            const existing = new Set(prev);
            const newOnes = data.filter(tx => !existing.has(tx));
            return [...prev, ...newOnes];
          });
        } else {
          setPendingTxs(prev => {
            const existing = new Set(prev);
            const newOnes = data.filter(tx => !existing.has(tx));
            return [...prev, ...newOnes];
          });
        }
      } catch (e) {
        // Do not clear the queue on error
      }
    }
    fetchPending()
    const interval = setInterval(fetchPending, 250)
    return () => clearInterval(interval)
  }, [])

  // Fetch available providers on component mount
  useEffect(() => {
    async function fetchProviders() {
      try {
        console.log('[DEBUG] Fetching providers from backend...');
        const response = await fetch(`${config.API_BASE_URL}/providers`);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const providerData = await response.json();
        console.log('[DEBUG] Providers loaded:', providerData);
        setProviders(providerData);
        
        // Load user ID from localStorage or generate new one
        let currentUserId = localStorage.getItem('ethsphere_userId');
        if (!currentUserId) {
          currentUserId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          localStorage.setItem('ethsphere_userId', currentUserId);
        }
        setUserId(currentUserId);
        
        // Check user's authentication status with backend
        try {
          const authResponse = await fetch(`${config.API_BASE_URL}/auth/status/${currentUserId}`);
          if (authResponse.ok) {
            const authData = await authResponse.json();
            const sessions = {};
            
            authData.providers.forEach(providerInfo => {
              sessions[providerInfo.provider] = {
                sessionId: providerInfo.sessionId,
                connectedAt: providerInfo.connectedAt,
                lastUsed: providerInfo.lastUsed
              };
            });
            
            console.log('[DEBUG] User sessions from server:', Object.keys(sessions));
            setUserSessions(sessions);
            setApiKeys(sessions); // Temporary compatibility
            
            // Set default provider if any are authenticated
            const authenticatedProviders = Object.keys(sessions);
            if (authenticatedProviders.length > 0) {
              const defaultProvider = authenticatedProviders[0];
              setSelectedProvider(defaultProvider);
              const defaultModel = providerData[defaultProvider]?.models?.find(m => m.recommended)?.id || 
                                   providerData[defaultProvider]?.models[0]?.id;
              setSelectedModel(defaultModel);
            }
          }
        } catch (error) {
          console.warn('Failed to load user sessions:', error);
        }
      } catch (error) {
        console.error('Failed to fetch providers:', error);
        // Set empty providers object to show error state
        setProviders({});
      }
    }
    
    fetchProviders();
  }, []);

  // Secure provider authentication functions
  const authenticateProvider = async (providerId, apiKey) => {
    try {
      // Use special secure endpoint for OpenAI
      const endpoint = providerId === 'openai' 
        ? `${config.API_BASE_URL}/auth/openai/secure-login`
        : `${config.API_BASE_URL}/auth/connect`;
        
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerId,
          apiKey: apiKey,
          userId: userId
        })
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Authentication failed');
      }
      
      console.log(`[AUTH] Successfully connected to ${providerId}:`, result);
      
      // Update sessions state
      const newSessions = {
        ...userSessions,
        [providerId]: {
          sessionId: result.sessionId,
          connectedAt: new Date().toISOString(),
          lastUsed: new Date().toISOString()
        }
      };
      setUserSessions(newSessions);
      setApiKeys(newSessions); // Temporary compatibility
      
      // Auto-select this provider and a default model
      setSelectedProvider(providerId);
      const defaultModel = providers[providerId]?.models?.find(m => m.recommended)?.id || 
                           providers[providerId]?.models[0]?.id;
      setSelectedModel(defaultModel);
      
      return { success: true, message: result.message };
    } catch (error) {
      console.error(`[AUTH] Failed to connect to ${providerId}:`, error);
      return { success: false, error: error.message };
    }
  };

  const removeAuthentication = async (providerId) => {
    const session = userSessions[providerId];
    if (!session) return;
    
    try {
      const response = await fetch(`${config.API_BASE_URL}/auth/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId
        })
      });
      
      if (response.ok) {
        console.log(`[AUTH] Disconnected from ${providerId}`);
      }
    } catch (error) {
      console.warn(`Failed to disconnect from ${providerId}:`, error);
    }
    
    // Update local state regardless of server response
    const newSessions = { ...userSessions };
    delete newSessions[providerId];
    setUserSessions(newSessions);
    
    const newApiKeys = { ...apiKeys };
    delete newApiKeys[providerId];
    setApiKeys(newApiKeys);
    
    // If this was the selected provider, clear selection
    if (selectedProvider === providerId) {
      setSelectedProvider(null);
      setSelectedModel(null);
    }
  };

  // Main animation stepper (strictly serial)
  useEffect(() => {
    if (processingRef.current || animating || !pendingTxs.length || selectedAddress) return;
    let cancelled = false;
    async function processNext() {
      processingRef.current = true;
      setAnimating(true);
      const hash = pendingTxs[0]; // Always process the front of the queue (FIFO)
      // 0. Fetch transaction details
      let data;
      try {
        const res = await fetch(`${config.API_BASE_URL}/tx/${hash}`);
        data = await res.json();
      } catch { setAnimating(false); processingRef.current = false; return; }
      if (!data || !data.from || !data.to) { setAnimating(false); processingRef.current = false; return; }
      const fromPos = addressToSphereCoords(data.from);
      const toPos = addressToSphereCoords(data.to);
      // 1. Twinkle for new from address
      let isNewFrom = !points.some(p => p.address === data.from);
      if (isNewFrom) {
        setTwinkle({ address: data.from, pos: fromPos, type: 'from' });
        await new Promise(res => setTimeout(res, txSpeed));
        // Fetch balance for new address
        let balance = null;
        try {
          const res = await fetch(`${config.API_BASE_URL}/balance/${data.from}`);
          const result = await res.json();
          if (result.balance) balance = result.balance;
        } catch {}
        setPoints(prev => prev.some(p => p.address === data.from) ? prev : [...prev, { address: data.from, pos: fromPos, balance, color: randomColor() }]);
        setTwinkle(null);
      }
      // 2. Trailblaze for the transaction line
      const txColor = hashToColor(hash);
      const amount = data.value;
      setTrail({ fromPos, toPos, color: txColor, progress: 0, amount });
      // Animate trailblaze
      await new Promise(res => {
        let start = null;
        function animateTrail(ts) {
          if (!start) start = ts;
          const elapsed = ts - start;
          const progress = Math.min(elapsed / txSpeed, 1); // use txSpeed
          setTrail(t => t && { ...t, progress });
          if (progress < 1) requestAnimationFrame(animateTrail);
          else res();
        }
        requestAnimationFrame(animateTrail);
      });
      setVisualized(prev => prev.some(v => v.hash === hash) ? prev : [...prev, { from: data.from, to: data.to, fromPos, toPos, hash, color: txColor, amount }]);
      setTrail(null);
      // After visualizing the transaction, play a random arpeggio note with pedal effect
      if (samplerRef.current) {
        const randomNote = arpeggio[Math.floor(Math.random() * arpeggio.length)];
        samplerRef.current.triggerAttackRelease(randomNote, '2n');
      }
      // Remove the transaction from the pending list and reset currentIdx
      setPendingTxs(prev => {
        const updated = prev.slice(1); // Remove the first (processed) transaction
        setCurrentIdx(0);
        return updated;
      });
      // 3. Twinkle for new to address
      let isNewTo = !points.some(p => p.address === data.to);
      if (isNewTo) {
        setTwinkle({ address: data.to, pos: toPos, type: 'to' });
        await new Promise(res => setTimeout(res, txSpeed));
        // Fetch balance for new address
        let balance = null;
        try {
          const res = await fetch(`${config.API_BASE_URL}/balance/${data.to}`);
          const result = await res.json();
          if (result.balance) balance = result.balance;
        } catch {}
        setPoints(prev => prev.some(p => p.address === data.to) ? prev : [...prev, { address: data.to, pos: toPos, balance, color: randomColor() }]);
        setTwinkle(null);
      }
      setAnimating(false);
      processingRef.current = false;
      // After animation, append any buffered transactions
      if (bufferedTxs.length > 0) {
        setPendingTxs(prev => {
          const existing = new Set(prev);
          const newOnes = bufferedTxs.filter(tx => !existing.has(tx));
          return [...prev, ...newOnes];
        });
        setBufferedTxs([]);
      }
      setTimeout(() => setCurrentIdx(idx => (idx + 1) % Math.max(1, pendingTxs.length)), 400);
    }
    processNext();
    // Only rerun when pendingTxs, animating, or selectedAddress changes
  }, [pendingTxs, animating, selectedAddress]);

  // Piano widget click handler
  function toggleNote(note) {
    setArpeggio(prev => {
      if (prev.includes(note)) {
        // Prevent removing the last note
        if (prev.length === 1) return prev;
        return prev.filter(n => n !== note);
      } else {
        return [...prev, note];
      }
    });
  }

  // Natural language to SQL conversion
  async function convertNaturalLanguageToSQL() {
    if (!nlInput.trim()) return;
    
    console.log('[DEBUG Frontend] Converting NL to SQL:', {
      selectedProvider,
      selectedModel, 
      hasApiKey: selectedProvider ? !!apiKeys[selectedProvider] : false,
      availableProviders: Object.keys(apiKeys),
      nlInput
    });
    
    setNlConverting(true);
    
    try {
      const requestBody = { naturalLanguage: nlInput };
      
      // Add session info if authenticated
      if (selectedProvider && userSessions[selectedProvider]) {
        requestBody.sessionId = userSessions[selectedProvider].sessionId;
        requestBody.provider = selectedProvider;
        requestBody.model = selectedModel;
        console.log('[DEBUG Frontend] Adding session data to request:', {
          provider: selectedProvider,
          model: selectedModel,
          sessionId: userSessions[selectedProvider].sessionId
        });
      } else {
        console.log('[DEBUG Frontend] No provider session available, using rule-based');
      }
      
      const response = await fetch(`${config.API_BASE_URL}/nl-to-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Conversion failed');
      }
      
      // Set the generated SQL and switch to SQL mode
      setQueryInput(data.sqlQuery);
      setConversionMethod(data.method);
      setNlMode(false);
    } catch (error) {
      setQueryError(error.message);
    } finally {
      setNlConverting(false);
    }
  }

  // Query execution handler
  async function executeQuery() {
    if (!queryInput.trim()) return;
    
    setQueryLoading(true);
    setQueryError(null);
    setQueryResults(null);
    
    try {
      const response = await fetch(`${config.API_BASE_URL}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql: queryInput })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Query failed');
      }
      
      setQueryResults(data);
    } catch (error) {
      setQueryError(error.message);
    } finally {
      setQueryLoading(false);
    }
  }

  // Example queries
  const exampleQueries = [
    'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10;',
    'SELECT COUNT(*) as total_transactions, COUNT(DISTINCT from_address) as unique_senders FROM transactions;',
    'SELECT from_address, COUNT(*) as tx_count FROM transactions GROUP BY from_address ORDER BY tx_count DESC LIMIT 5;',
    'SELECT DATE(created_at) as date, COUNT(*) as daily_txs FROM transactions GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 7;',
    'SELECT AVG(CAST(value AS BIGINT)) as avg_value, MAX(CAST(value AS BIGINT)) as max_value FROM transactions WHERE CAST(value AS BIGINT) > 0;'
  ];

  // Example natural language queries
  const exampleNLQueries = [
    'Show me the 10 most recent transactions',
    'How many transactions are there in total?',
    'Who are the top 5 most active senders?',
    'What is the average transaction value?',
    'Show me transactions with the highest values',
    'Show me daily transaction counts for the past week',
    'What are the average and maximum gas prices?',
    'Show me all transactions for address 0x123...'
  ];

  // Stable refs for CSSTransition nodeRef
  const txRefs = useReactRef({});

  // Piano widget draggable position
  const [pianoPos, setPianoPos] = useState({ x: window.innerWidth / 2 - 220, y: window.innerHeight - 180 });
  const pianoDragging = useRef(false);
  const [pianoDraggingState, setPianoDraggingState] = useState(false); // NEW: state for dragging
  const pianoDragOffset = useRef({ x: 0, y: 0 });

  // Query panel state
  const [queryPanelVisible, setQueryPanelVisible] = useState(false);
  const [queryInput, setQueryInput] = useState('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10;');
  const [queryResults, setQueryResults] = useState(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState(null);

  // Natural language query state
  const [nlMode, setNlMode] = useState(false);
  const [nlInput, setNlInput] = useState('Show me the 10 most recent transactions');
  const [nlConverting, setNlConverting] = useState(false);
  const [conversionMethod, setConversionMethod] = useState(null);

  // Multi-provider authentication state
  const [providers, setProviders] = useState({});
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [userSessions, setUserSessions] = useState({});
  const [userId, setUserId] = useState(null);
  const [authPanelVisible, setAuthPanelVisible] = useState(false);
  const [apiKeys, setApiKeys] = useState({}); // Keeping for backward compatibility

  // Query panel resizing state
  const [queryPanelHeight, setQueryPanelHeight] = useState(window.innerHeight * 0.5); // 50vh
  const [leftPanelWidth, setLeftPanelWidth] = useState(40); // 40% of query panel width
  const [queryTextHeight, setQueryTextHeight] = useState(120);
  
  // Query panel resize refs and state
  const queryPanelResizing = useRef(false);
  const horizontalResizing = useRef(false);
  const queryTextResizing = useRef(false);
  const resizeStartY = useRef(0);
  const resizeStartX = useRef(0);
  const resizeStartHeight = useRef(0);
  const resizeStartWidth = useRef(0);

  useEffect(() => {
    function onMouseMove(e) {
      if (pianoDragging.current) {
        let newX = e.clientX - pianoDragOffset.current.x;
        let newY = e.clientY - pianoDragOffset.current.y;
        // Clamp to window bounds
        newX = Math.max(0, Math.min(window.innerWidth - 440, newX));
        newY = Math.max(0, Math.min(window.innerHeight - 120, newY));
        setPianoPos({ x: newX, y: newY });
      }
    }
    function onMouseUp() {
      pianoDragging.current = false;
      setPianoDraggingState(false); // NEW: update state
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
    if (pianoDraggingState) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [pianoDraggingState]); // Depend on state

  // Query panel resize handlers
  useEffect(() => {
    function onMouseMove(e) {
      if (queryPanelResizing.current) {
        const deltaY = resizeStartY.current - e.clientY; // Inverted because panel grows upward
        const newHeight = Math.max(200, Math.min(window.innerHeight - 100, resizeStartHeight.current + deltaY));
        setQueryPanelHeight(newHeight);
      }
      
      if (horizontalResizing.current) {
        const deltaX = e.clientX - resizeStartX.current;
        const containerWidth = window.innerWidth - (sidebarCollapsed ? 36 : sidebarWidth) - 32; // Account for padding
        const newWidthPercent = Math.max(20, Math.min(80, resizeStartWidth.current + (deltaX / containerWidth) * 100));
        setLeftPanelWidth(newWidthPercent);
      }
      
      if (queryTextResizing.current) {
        const deltaY = e.clientY - resizeStartY.current;
        const newHeight = Math.max(80, Math.min(400, resizeStartHeight.current + deltaY));
        setQueryTextHeight(newHeight);
      }
    }
    
    function onMouseUp() {
      queryPanelResizing.current = false;
      horizontalResizing.current = false;
      queryTextResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    
    if (queryPanelResizing.current || horizontalResizing.current || queryTextResizing.current) {
      document.body.style.cursor = queryPanelResizing.current ? 'ns-resize' : 
                                   queryTextResizing.current ? 'ns-resize' : 'ew-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [queryPanelResizing.current, horizontalResizing.current, queryTextResizing.current, sidebarCollapsed, sidebarWidth]);

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', background: '#111', flexDirection: 'row' }}>
      {/* Sidebar - Hidden on mobile */}
      {!isMobile && (
        <div
          style={{
            width: sidebarCollapsed ? 36 : sidebarWidth,
            minWidth: sidebarCollapsed ? 36 : minSidebarWidth,
            maxWidth: sidebarCollapsed ? 36 : maxSidebarWidth,
            background: '#181818',
            color: '#fff',
            borderRight: '1px solid #222',
            transition: 'width 0.25s cubic-bezier(.4,2,.6,1)',
            position: 'relative',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            alignItems: sidebarCollapsed ? 'center' : 'stretch',
            userSelect: dragging.current ? 'none' : 'auto',
            height: '100vh',
            zIndex: 10,
          }}
        >
        <button
          style={{
            position: 'absolute',
            top: 12,
            right: sidebarCollapsed ? 2 : 12,
            zIndex: 2,
            width: 24,
            height: 24,
            border: 'none',
            background: 'none',
            color: '#4fd1c5',
            cursor: 'pointer',
            fontSize: 20,
            borderRadius: 4,
            outline: 'none',
            transition: 'right 0.25s',
          }}
          onClick={() => setSidebarCollapsed(c => !c)}
          title={sidebarCollapsed ? 'Expand' : 'Collapse'}
        >
          {sidebarCollapsed ? '▶' : '◀'}
        </button>
        {/* Drag handle */}
        {!sidebarCollapsed && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 8,
              height: '100%',
              zIndex: 20,
              background: 'linear-gradient(to left, #222 60%, transparent)',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'ew-resize',
            }}
            onMouseDown={e => {
              console.log('Drag handle mouse down');
              dragging.current = true;
              dragStartX.current = e.clientX;
              dragStartWidth.current = sidebarWidth;
              e.preventDefault();
            }}
          >
            <div style={{ width: 2, height: 32, background: '#444', borderRadius: 2 }} />
          </div>
        )}
        {/* Sidebar content */}
        {!sidebarCollapsed && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
            <h2 style={{ marginTop: 0, marginBottom: 16, paddingLeft: 12 }}>Pending Transactions</h2>
            <div style={{ overflowY: 'auto', paddingRight: 12, marginRight: 8, paddingLeft: 12, flex: 1, marginBottom: 0, paddingBottom: 0, minHeight: 0, height: '100%' }}>
              {pendingTxs.length === 0 && <div>No pending transactions.</div>}
              <TransitionGroup component="ul" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {pendingTxs.slice(0, 50).map((hash, idx) => {
                  if (!txRefs.current[hash]) txRefs.current[hash] = createRef();
                  const nodeRef = txRefs.current[hash];
                  return (
                    <CSSTransition key={hash} timeout={600} classNames="tx-fade" nodeRef={nodeRef}>
                      <li
                        ref={nodeRef}
                        style={{
                          marginBottom: 0,
                          wordBreak: 'break-all',
                          fontSize: 13,
                          fontWeight: idx === 0 ? 'bold' : 'normal',
                          color: idx === 0 ? '#4fd1c5' : '#fff',
                          borderBottom: idx !== pendingTxs.length - 1 ? '1px solid #222' : 'none',
                          padding: '12px 0',
                          paddingRight: 8,
                          paddingLeft: 4,
                          background: 'transparent',
                        }}
                      >
                        <a
                          href={`https://etherscan.io/tx/${hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          {hash}
                        </a>
                      </li>
                    </CSSTransition>
                  );
                })}
              </TransitionGroup>
            </div>
          </div>
        )}
        </div>
      )}
      {/* Main content area (sphere, overlays, etc.) */}
      <div style={{ flex: 1, position: 'relative', height: '100vh', overflow: 'hidden' }}>
        {/* Top-right overlay for counts and query button */}
        <div
          style={{
            position: 'fixed',
            top: isMobile ? 12 : 18,
            right: isMobile ? 12 : 24,
            zIndex: 3000,
            display: 'flex',
            flexDirection: 'column',
            gap: isMobile ? 8 : 12,
            alignItems: 'flex-end',
          }}
        >
          <div
            style={{
              background: 'rgba(24,24,24,0.92)',
              color: '#4fd1c5',
              padding: isMobile ? '8px 12px' : '12px 22px',
              borderRadius: 10,
              fontSize: isMobile ? 12 : 16,
              fontWeight: 600,
              boxShadow: '0 2px 12px #000a',
              letterSpacing: 0.2,
              minWidth: isMobile ? 80 : 120,
              textAlign: 'right',
              pointerEvents: 'none',
            }}
          >
            <div>Addresses: {points.length}</div>
            <div>Transactions: {visualized.length}</div>
          </div>
          <div style={{ display: 'flex', gap: isMobile ? 6 : 8, flexDirection: isMobile ? 'column' : 'row' }}>
            <button
              style={{
                background: authPanelVisible ? '#ff6b6b' : 'rgba(24,24,24,0.92)',
                color: authPanelVisible ? '#fff' : selectedProvider && apiKeys[selectedProvider] ? '#4fd1c5' : '#ffa500',
                border: authPanelVisible ? 'none' : selectedProvider && apiKeys[selectedProvider] ? '1px solid #4fd1c5' : '1px solid #ffa500',
                padding: isMobile ? '6px 12px' : '8px 16px',
                borderRadius: 8,
                fontSize: isMobile ? 12 : 14,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 12px #000a',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
              }}
              onClick={() => setAuthPanelVisible(!authPanelVisible)}
            >
              {authPanelVisible ? '✕ Close AI' : selectedProvider && apiKeys[selectedProvider] ? `🤖 ${isMobile ? 'AI' : providers[selectedProvider]?.name}` : '🔑 Setup AI'}
            </button>
            <button
              style={{
                background: queryPanelVisible ? '#4fd1c5' : 'rgba(24,24,24,0.92)',
                color: queryPanelVisible ? '#000' : '#4fd1c5',
                border: queryPanelVisible ? 'none' : '1px solid #4fd1c5',
                padding: isMobile ? '6px 12px' : '8px 16px',
                borderRadius: 8,
                fontSize: isMobile ? 12 : 14,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 12px #000a',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
              }}
              onClick={() => setQueryPanelVisible(!queryPanelVisible)}
            >
              {queryPanelVisible ? '✕ Close' : '⚡ SQL'}
            </button>
          </div>
        </div>
        {/* Top-left logo/image overlay, responsive positioning */}
        <img
          src={"/logo.png"}
          alt="Logo"
          style={{
            position: 'fixed',
            top: 16,
            left: isMobile ? 16 : (sidebarCollapsed ? 36 : sidebarWidth) + 16,
            height: isMobile ? 120 : 200,
            width: 'auto',
            zIndex: 2000,
            pointerEvents: 'none',
            transition: 'left 0.25s cubic-bezier(.4,2,.6,1)',
          }}
        />
        {/* 3D Sphere */}
        <Canvas
          camera={{ position: [0, 0, 5], fov: 60 }}
          onDoubleClick={e => {
            // Only clear if not clicking on a mesh (background)
            if (selectedAddress && (!e.intersections || e.intersections.length === 0)) {
              setSelectedAddress(null);
            }
          }}
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 5, 5]} intensity={1} />
          <Sphere args={[1, 64, 64]}>
            <meshStandardMaterial attach="material" color="#4fd1c5" transparent={true} opacity={0.1} />
          </Sphere>
          {/* Twinkle animation for new points */}
          {twinkle && (
            (!selectedAddress ||
              twinkle.address === selectedAddress ||
              visualized.some(v =>
                (v.from === selectedAddress && v.to === twinkle.address) ||
                (v.to === selectedAddress && v.from === twinkle.address)
              )
            ) && <TwinklePoint pos={twinkle.pos} duration={txSpeed} />
          )}
          {/* Render all unique points */}
          {points
            .filter(({ address }) => {
              if (!selectedAddress) return true;
              // Show selected address and all addresses linked to it
              const isLinked = visualized.some(
                v => (v.from === selectedAddress && v.to === address) || (v.to === selectedAddress && v.from === address)
              );
              return address === selectedAddress || isLinked;
            })
            .map(({ pos, address, balance, color }) => (
              <mesh
                key={address}
                position={pos}
                onClick={e => {
                  if ((e.metaKey || e.ctrlKey) && selectedAddress) {
                    window.open(`https://etherscan.io/address/${address}`, '_blank', 'noopener');
                  } else {
                    e.stopPropagation();
                    setSelectedAddress(a => (a === address ? null : address));
                  }
                }}
                // Make selected address larger
                scale={address === selectedAddress ? 1.7 : 1}
                onPointerOver={e => {
                  if (selectedAddress) {
                    setHoveredAddress(address);
                    setPopupPos({ x: e.clientX, y: e.clientY });
                  }
                }}
                onPointerMove={e => {
                  if (selectedAddress && hoveredAddress === address) {
                    setPopupPos({ x: e.clientX, y: e.clientY });
                  }
                }}
                onPointerOut={e => {
                  setHoveredAddress(null);
                }}
              >
                <sphereGeometry args={[0.01, 16, 16]} />
                <meshStandardMaterial color={color} />
              </mesh>
            ))}
          {/* Trailblazing animation for the line */}
          {trail && !selectedAddress && (() => {
            const N = 32; // Number of segments for smoothness
            const points = [];
            for (let i = 0; i <= N * trail.progress; ++i) {
              const t = i / N;
              points.push(...trail.fromPos.map((v, idx) => v + (trail.toPos[idx] - v) * t));
            }
            const headPos = trail.fromPos.map((v, i) => v + (trail.toPos[i] - v) * trail.progress);
            return (
              <>
                <line>
                  <bufferGeometry>
                    <bufferAttribute attach="attributes-position" count={points.length / 3} array={new Float32Array(points)} itemSize={3} />
                  </bufferGeometry>
                  <lineBasicMaterial color={trail.color} linewidth={2} />
                </line>
                {/* Glowing head at the end of the animated line */}
                <mesh position={headPos}>
                  <sphereGeometry args={[0.012, 16, 16]} />
                  <meshStandardMaterial color={trail.color} emissive={trail.color} emissiveIntensity={2} />
                </mesh>
              </>
            );
          })()}
          {/* Render all accumulated lines */}
          {visualized
            .filter(({ from, to }) => {
              if (!selectedAddress) return true;
              return from === selectedAddress || to === selectedAddress;
            })
            .map(({ fromPos, toPos, hash, from, to, amount }) => {
              // Get colors for from and to addresses
              const fromColor = (points.find(p => p.address === from) || {}).color || '#fff';
              const toColor = (points.find(p => p.address === to) || {}).color || '#fff';
              // For cylinders (selected), use average color as placeholder
              function averageColor(hex1, hex2) {
                const c1 = parseInt(hex1.slice(1), 16);
                const c2 = parseInt(hex2.slice(1), 16);
                const r = ((c1 >> 16) + (c2 >> 16)) >> 1;
                const g = (((c1 >> 8) & 0xff) + ((c2 >> 8) & 0xff)) >> 1;
                const b = ((c1 & 0xff) + (c2 & 0xff)) >> 1;
                return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
              }
              return (
                <group key={hash}>
                  {selectedAddress
                    ? <mesh
                        onClick={e => {
                          if (e.metaKey || e.ctrlKey) {
                            window.open(`https://etherscan.io/tx/${hash}`, '_blank', 'noopener');
                          }
                        }}
                        onPointerOver={e => {
                          setHoveredTx({ hash, amount });
                          setTxPopupPos({ x: e.clientX, y: e.clientY });
                        }}
                        onPointerMove={e => {
                          setTxPopupPos({ x: e.clientX, y: e.clientY });
                        }}
                        onPointerOut={e => {
                          setHoveredTx(null);
                        }}
                      >
                        <CylinderBetween start={fromPos} end={toPos} color={averageColor(fromColor, toColor)} />
                      </mesh>
                    : (
                      <line>
                        <bufferGeometry>
                          <bufferAttribute attach="attributes-position" count={2} array={new Float32Array([...fromPos, ...toPos])} itemSize={3} />
                          <bufferAttribute
                            attach="attributes-color"
                            count={2}
                            array={new Float32Array([
                              ...new THREE.Color(fromColor).toArray(),
                              ...new THREE.Color(toColor).toArray(),
                            ])}
                            itemSize={3}
                          />
                        </bufferGeometry>
                        <lineBasicMaterial vertexColors linewidth={2} />
                      </line>
                    )}
                </group>
              );
            })}
          <OrbitControls enablePan={false} />
        </Canvas>
        {/* Popup for hovered address in clicked state */}
        {selectedAddress && hoveredAddress && (
          <div
            style={{
              position: 'fixed',
              left: popupPos.x + 12,
              top: popupPos.y + 12,
              background: '#222',
              color: '#fff',
              padding: '10px 16px',
              borderRadius: 8,
              pointerEvents: 'none', // disables pointer events for the popup
              fontSize: 14,
              zIndex: 1000,
              boxShadow: '0 2px 12px #000a',
              minWidth: 220,
            }}
          >
            <div
              style={{
                fontWeight: 'bold',
                marginBottom: 4,
                color: '#4fd1c5',
                userSelect: 'text',
                wordBreak: 'break-all',
                pointerEvents: 'auto',
              }}
            >
              Address: {hoveredAddress}
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6 }}>
              Cmd+Click (Mac) or Ctrl+Click (Win/Linux) the node to open in Etherscan
            </div>
            <div>
              ETH Balance: {
                (() => {
                  const point = points.find(p => p.address === hoveredAddress);
                  if (!point) return 'Loading...';
                  if (!point.balance) return 'Error';
                  return `${formatEther(point.balance)} ETH`;
                })()
              }
            </div>
          </div>
        )}
        {/* Popup for hovered transaction in clicked state */}
        {selectedAddress && hoveredTx && (
          <div
            style={{
              position: 'fixed',
              left: txPopupPos.x + 12,
              top: txPopupPos.y + 12,
              background: '#222',
              color: '#fff',
              padding: '10px 16px',
              borderRadius: 8,
              pointerEvents: 'none',
              fontSize: 14,
              zIndex: 1000,
              boxShadow: '0 2px 12px #000a',
              minWidth: 220,
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: 4, color: '#4fd1c5', wordBreak: 'break-all' }}>
              Tx Hash: {hoveredTx.hash}
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6 }}>
              Cmd+Click (Mac) or Ctrl+Click (Win/Linux) the cylinder to open in Etherscan
            </div>
            <div>
              Amount: {hoveredTx.amount && hoveredTx.amount.hex ? `${formatEther(BigInt(hoveredTx.amount.hex))} ETH` : 'N/A'}
            </div>
          </div>
        )}
        {/* Transaction speed slider at bottom center of page, fixed and draggable - Hidden on mobile */}
        {!isMobile && (
        <div
          style={{
            position: 'fixed',
            left: sliderPos.x,
            top: sliderPos.y,
            zIndex: 100,
            background: '#181818',
            borderRadius: 12,
            boxShadow: '0 2px 12px #000a',
            padding: '18px 32px 14px 32px',
            minWidth: 320,
            maxWidth: 480,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            border: '1px solid #222',
            cursor: sliderDragging.current ? 'grabbing' : 'grab',
            userSelect: 'none',
          }}
          onMouseDown={e => {
            // Only drag if not clicking the slider input
            if (e.target.tagName === 'INPUT') return;
            sliderDragging.current = true;
            setSliderDraggingState(true); // NEW: update state
            sliderDragOffset.current = {
              x: e.clientX - sliderPos.x,
              y: e.clientY - sliderPos.y,
            };
          }}
        >
          <div style={{ width: '60%', height: 1, background: '#222', margin: '0 auto 14px auto', borderRadius: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
            <span style={{ fontSize: 12, color: '#aaa' }}>Slower</span>
            <input
              type="range"
              min={5}
              max={3000}
              step={5}
              value={3000 - (txSpeed - 5)}
              onChange={e => setTxSpeed(3000 - (Number(e.target.value) - 5))}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 12, color: '#aaa' }}>Faster</span>
            <span style={{ fontSize: 12, color: '#4fd1c5', minWidth: 48, textAlign: 'right' }}>{txSpeed} ms</span>
          </div>
        </div>
        )}
        {/* Piano widget, draggable - Hidden on mobile */}
        {!isMobile && (
        <div
          style={{
            position: 'fixed',
            left: pianoPos.x,
            top: pianoPos.y,
            zIndex: 3000,
            display: 'flex',
            flexDirection: 'row',
            background: '#222',
            borderRadius: 12,
            boxShadow: '0 2px 12px #000a',
            padding: '16px 24px',
            alignItems: 'flex-end',
            userSelect: 'none',
            cursor: pianoDragging.current ? 'grabbing' : 'grab',
            transform: 'rotate(180deg) scaleX(-1)',
          }}
          onMouseDown={e => {
            // Only drag if not clicking a button
            if (e.target.tagName === 'BUTTON') return;
            pianoDragging.current = true;
            setPianoDraggingState(true); // NEW: update state
            pianoDragOffset.current = {
              x: e.clientX - pianoPos.x,
              y: e.clientY - pianoPos.y,
            };
          }}
        >
          {PIANO_NOTES.map(note => {
            const isSharp = note.includes('#');
            const isSelected = arpeggio.includes(note);
            return (
              <button
                key={note}
                onClick={() => toggleNote(note)}
                style={{
                  width: isSharp ? 24 : 36,
                  height: isSharp ? 60 : 100,
                  marginLeft: isSharp ? -12 : 0,
                  marginRight: isSharp ? -12 : 4,
                  background: isSelected ? (isSharp ? '#4fd1c5' : '#fff700') : (isSharp ? '#222' : '#fff'),
                  color: isSharp ? '#fff' : '#222',
                  border: isSelected ? '2px solid #4fd1c5' : '1px solid #888',
                  borderRadius: 4,
                  position: isSharp ? 'relative' : 'static',
                  zIndex: isSharp ? 2 : 1,
                  boxShadow: isSelected ? '0 0 8px #4fd1c5' : undefined,
                  cursor: 'pointer',
                  fontWeight: isSelected ? 'bold' : 'normal',
                  fontSize: 14,
                  outline: 'none',
                  transition: 'background 0.2s, border 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                tabIndex={-1}
              >
                <span style={{ transform: 'rotate(180deg) scaleX(-1)', display: 'inline-block' }}>{note.replace('4', '')}</span>
              </button>
            );
          })}
        </div>
        )}

        {/* AI Authentication Panel */}
        {authPanelVisible && (
          <div
            style={{
              position: 'fixed',
              top: 80,
              right: 24,
              width: 400,
              maxHeight: '70vh',
              background: 'rgba(24,24,24,0.96)',
              backdropFilter: 'blur(12px)',
              border: '1px solid #333',
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              zIndex: 4000,
              overflow: 'hidden',
            }}
          >
            <div style={{
              padding: '20px 24px 16px 24px',
              borderBottom: '1px solid #333',
              background: 'rgba(79,209,197,0.1)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}>
              <div>
                <h3 style={{
                  margin: 0,
                  color: '#4fd1c5',
                  fontSize: 18,
                  fontWeight: 600,
                }}>
                  🤖 AI Provider Setup
                </h3>
                <p style={{
                  margin: '8px 0 0 0',
                  color: '#aaa',
                  fontSize: 14,
                  lineHeight: 1.4,
                }}>
                  Connect your AI provider to enable natural language SQL queries
                </p>
              </div>
              <button
                onClick={() => setAuthPanelVisible(false)}
                style={{
                  background: 'transparent',
                  color: '#aaa',
                  border: 'none',
                  fontSize: 20,
                  cursor: 'pointer',
                  padding: 4,
                  borderRadius: 4,
                  transition: 'color 0.2s',
                  lineHeight: 1,
                }}
                onMouseOver={(e) => e.target.style.color = '#fff'}
                onMouseOut={(e) => e.target.style.color = '#aaa'}
              >
                ✕
              </button>
            </div>
            
            <div style={{
              maxHeight: 'calc(70vh - 100px)',
              overflowY: 'auto',
              padding: '0 24px 24px 24px',
            }}>
              {Object.entries(providers).map(([providerId, provider]) => (
                <div
                  key={providerId}
                  style={{
                    marginTop: 20,
                    padding: 16,
                    border: `1px solid ${apiKeys[providerId] ? '#4fd1c5' : '#333'}`,
                    borderRadius: 8,
                    background: apiKeys[providerId] ? 'rgba(79,209,197,0.05)' : 'transparent',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}>
                    <div>
                      <h4 style={{
                        margin: 0,
                        color: apiKeys[providerId] ? '#4fd1c5' : '#fff',
                        fontSize: 16,
                        fontWeight: 600,
                      }}>
                        {provider.name}
                        {apiKeys[providerId] && (
                          <span style={{
                            marginLeft: 8,
                            color: '#4fd1c5',
                            fontSize: 12,
                          }}>
                            ✓ Connected
                          </span>
                        )}
                      </h4>
                      <p style={{
                        margin: '4px 0 0 0',
                        color: '#aaa',
                        fontSize: 12,
                      }}>
                        {provider.description}
                        {providerId === 'openai' && (
                          <span style={{
                            display: 'block',
                            color: '#4fd1c5',
                            fontWeight: 600,
                            marginTop: 4,
                          }}>
                            🔒 Enhanced Security: API key encrypted + usage validation
                          </span>
                        )}
                      </p>
                    </div>
                    {apiKeys[providerId] && (
                      <button
                        onClick={() => removeAuthentication(providerId)}
                        style={{
                          background: 'transparent',
                          color: '#ff6b6b',
                          border: '1px solid #ff6b6b',
                          padding: '4px 8px',
                          borderRadius: 4,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                  
                  {!apiKeys[providerId] ? (
                    <div>
                      <input
                        type="password"
                        placeholder={providerId === 'openai' 
                          ? `Enter your OpenAI API key (starts with sk-...) - Will be encrypted & validated`
                          : `Enter your ${provider.name} API key`}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          marginBottom: 8,
                          background: '#1a1a1a',
                          border: '1px solid #333',
                          borderRadius: 6,
                          color: '#fff',
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter' && e.target.value.trim()) {
                            e.target.disabled = true;
                            const result = await authenticateProvider(providerId, e.target.value.trim());
                            if (result.success) {
                              e.target.value = '';
                            } else {
                              alert(`Failed to connect: ${result.error}`);
                            }
                            e.target.disabled = false;
                          }
                        }}
                      />
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}>
                        <a
                          href={provider.signupUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: '#4fd1c5',
                            fontSize: 12,
                            textDecoration: 'none',
                          }}
                        >
                          Get API Key →
                        </a>
                        <button
                          onClick={async (e) => {
                            const input = e.target.parentElement.parentElement.querySelector('input');
                            if (input.value.trim()) {
                              e.target.disabled = true;
                              e.target.textContent = 'Connecting...';
                              
                              const result = await authenticateProvider(providerId, input.value.trim());
                              
                              if (result.success) {
                                input.value = '';
                              } else {
                                alert(`Failed to connect: ${result.error}`);
                                e.target.disabled = false;
                                e.target.textContent = 'Connect';
                              }
                            }
                          }}
                          style={{
                            background: '#4fd1c5',
                            color: '#000',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: 4,
                            fontSize: 12,
                            cursor: 'pointer',
                            fontWeight: 600,
                          }}
                        >
                          Connect
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={{
                          display: 'block',
                          color: '#ccc',
                          fontSize: 12,
                          marginBottom: 4,
                        }}>
                          Model:
                        </label>
                        <select
                          value={selectedProvider === providerId ? selectedModel || '' : ''}
                          onChange={(e) => {
                            setSelectedProvider(providerId);
                            setSelectedModel(e.target.value);
                          }}
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            background: '#1a1a1a',
                            border: '1px solid #333',
                            borderRadius: 4,
                            color: '#fff',
                            fontSize: 12,
                          }}
                        >
                          {provider.models.map(model => (
                            <option key={model.id} value={model.id}>
                              {model.name} {model.recommended ? '(Recommended)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}>
                          <input
                            type="radio"
                            id={`select-${providerId}`}
                            name="selectedProvider"
                            checked={selectedProvider === providerId}
                            onChange={() => {
                              setSelectedProvider(providerId);
                              const defaultModel = provider.models.find(m => m.recommended)?.id || 
                                                   provider.models[0]?.id;
                              setSelectedModel(defaultModel);
                            }}
                            style={{
                              accentColor: '#4fd1c5',
                            }}
                          />
                          <label
                            htmlFor={`select-${providerId}`}
                            style={{
                              color: selectedProvider === providerId ? '#4fd1c5' : '#ccc',
                              fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            Use for queries
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              
              {Object.keys(apiKeys).length === 0 && (
                <div style={{
                  marginTop: 20,
                  padding: 16,
                  background: 'rgba(255,165,0,0.1)',
                  border: '1px solid rgba(255,165,0,0.3)',
                  borderRadius: 8,
                  textAlign: 'center',
                }}>
                  <p style={{
                    margin: 0,
                    color: '#ffa500',
                    fontSize: 14,
                  }}>
                    💡 Connect any AI provider to unlock intelligent SQL generation from natural language
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Query Panel */}
        {queryPanelVisible && (
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: isMobile ? 0 : (sidebarCollapsed ? 36 : sidebarWidth),
              right: 0,
              top: isMobile ? 0 : 'auto',
              height: isMobile ? '100vh' : queryPanelHeight,
              background: '#181818',
              borderTop: isMobile ? 'none' : '2px solid #4fd1c5',
              zIndex: isMobile ? 4000 : 2000,
              transition: 'left 0.25s cubic-bezier(.4,2,.6,1)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Vertical Resize Handle - Hidden on mobile */}
            {!isMobile && (
              <div
                style={{
                  position: 'absolute',
                  top: -4,
                  left: 0,
                  right: 0,
                  height: 8,
                  cursor: 'ns-resize',
                  background: 'linear-gradient(to bottom, transparent, #4fd1c5 50%, transparent)',
                  zIndex: 10,
                }}
                onMouseDown={(e) => {
                  queryPanelResizing.current = true;
                  resizeStartY.current = e.clientY;
                  resizeStartHeight.current = queryPanelHeight;
                  e.preventDefault();
                }}
              />
            )}
            {/* Query Panel Header */}
            <div
              style={{
                padding: '16px 24px',
                borderBottom: '1px solid #222',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#222',
              }}
            >
              <h3 style={{ margin: 0, color: '#4fd1c5', fontSize: 18, fontWeight: 600 }}>
                SQL Query Interface
              </h3>
              <button
                style={{
                  background: 'none',
                  border: '1px solid #4fd1c5',
                  color: '#4fd1c5',
                  padding: '6px 12px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
                onClick={() => setQueryPanelVisible(false)}
              >
                Close ✕
              </button>
            </div>

            {/* Query Panel Content */}
            <div style={{ 
              flex: 1, 
              display: 'flex', 
              flexDirection: isMobile ? 'column' : 'row',
              padding: isMobile ? 12 : 16, 
              gap: isMobile ? 12 : 16, 
              minHeight: 0 
            }}>
              {/* Left Side - Query Input */}
              <div style={{ 
                width: isMobile ? '100%' : `${leftPanelWidth}%`, 
                display: 'flex', 
                flexDirection: 'column', 
                gap: 12,
                minWidth: isMobile ? 'auto' : '200px',
                flex: isMobile ? 'none' : 'initial'
              }}>
                <div>
                  {/* Query Mode Toggle */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ color: '#aaa', fontSize: 14, fontWeight: 500, marginRight: 'auto' }}>
                        {nlMode ? 'Natural Language Query:' : 'SQL Query:'}
                        {!nlMode && conversionMethod && (
                          <span style={{ 
                            color: conversionMethod === 'groq' ? '#4fd1c5' : '#666',
                            fontSize: 11,
                            marginLeft: 8,
                            fontWeight: 400
                          }}>
                            ({conversionMethod && conversionMethod !== 'rule-based' ? `🤖 ${providers[conversionMethod]?.name || conversionMethod}` : '📋 Rule-based'})
                          </span>
                        )}
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          onClick={() => {
                            setNlMode(!nlMode);
                            if (nlMode) setConversionMethod(null);
                          }}
                          style={{
                            background: nlMode ? '#4fd1c5' : 'rgba(24,24,24,0.8)',
                            color: nlMode ? '#000' : '#4fd1c5',
                            border: '1px solid #4fd1c5',
                            padding: '6px 12px',
                            borderRadius: 6,
                            cursor: 'pointer',
                            fontSize: 13,
                            fontWeight: 600,
                            transition: 'all 0.2s',
                            boxShadow: nlMode ? '0 2px 8px rgba(79,209,197,0.3)' : 'none',
                          }}
                        >
                          {nlMode ? '🤖 Natural Language' : '💻 Switch to NL'}
                        </button>
                      </div>
                    </div>
                    {nlMode && (
                      <div style={{
                        padding: '8px 12px',
                        background: 'rgba(79,209,197,0.1)',
                        border: '1px solid rgba(79,209,197,0.3)',
                        borderRadius: 6,
                        fontSize: 12,
                        color: '#aaa',
                        marginBottom: 8,
                      }}>
                        💡 <strong style={{ color: '#4fd1c5' }}>Natural Language Mode:</strong> Ask questions in plain English! 
                        {selectedProvider && apiKeys[selectedProvider] ? 
                          ` Using ${providers[selectedProvider]?.name} AI to generate SQL.` : 
                          ' Connect an AI provider above for smarter queries, or use basic rule-based conversion.'
                        }
                      </div>
                    )}
                  </div>

                  <div style={{ position: 'relative' }}>
                    {nlMode ? (
                      <textarea
                        value={nlInput}
                        onChange={(e) => setNlInput(e.target.value)}
                        style={{
                          width: '100%',
                          height: queryTextHeight,
                          background: '#111',
                          color: '#fff',
                          border: '1px solid #4fd1c5',
                          borderRadius: 6,
                          padding: 12,
                          fontFamily: 'system-ui, -apple-system, sans-serif',
                          fontSize: 14,
                          resize: 'none',
                          outline: 'none',
                        }}
                        placeholder="Describe what you want to find in plain English..."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            convertNaturalLanguageToSQL();
                          }
                        }}
                      />
                    ) : (
                      <textarea
                        value={queryInput}
                        onChange={(e) => setQueryInput(e.target.value)}
                        style={{
                          width: '100%',
                          height: queryTextHeight,
                          background: '#111',
                          color: '#fff',
                          border: '1px solid #333',
                          borderRadius: 6,
                          padding: 12,
                          fontFamily: 'Monaco, Consolas, monospace',
                          fontSize: 13,
                          resize: 'none',
                          outline: 'none',
                        }}
                        placeholder="Enter your SQL query here..."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            executeQuery();
                          }
                        }}
                      />
                    )}
                    {/* Textarea Resize Handle */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: -4,
                        left: 0,
                        right: 0,
                        height: 8,
                        cursor: 'ns-resize',
                        background: 'linear-gradient(to top, transparent, #333 50%, transparent)',
                      }}
                      onMouseDown={(e) => {
                        queryTextResizing.current = true;
                        resizeStartY.current = e.clientY;
                        resizeStartHeight.current = queryTextHeight;
                        e.preventDefault();
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {nlMode ? (
                    <>
                      <button
                        onClick={convertNaturalLanguageToSQL}
                        disabled={nlConverting}
                        style={{
                          background: nlConverting ? '#333' : selectedProvider && apiKeys[selectedProvider] ? '#4fd1c5' : '#ffa500',
                          color: nlConverting ? '#666' : '#000',
                          border: 'none',
                          padding: '10px 20px',
                          borderRadius: 6,
                          cursor: nlConverting ? 'not-allowed' : 'pointer',
                          fontSize: 14,
                          fontWeight: 600,
                          transition: 'all 0.2s',
                          boxShadow: selectedProvider && apiKeys[selectedProvider] ? '0 2px 8px rgba(79,209,197,0.3)' : '0 2px 8px rgba(255,165,0,0.3)',
                        }}
                      >
                        {nlConverting ? 'Converting...' : selectedProvider && apiKeys[selectedProvider] ? `🤖 Convert with ${providers[selectedProvider]?.name}` : '📋 Convert (Basic)'} 
                      </button>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                        <span style={{ color: '#666', fontSize: 12 }}>
                          Cmd+Enter to convert
                        </span>
                        {!selectedProvider || !apiKeys[selectedProvider] ? (
                          <span style={{ color: '#ffa500', fontSize: 11 }}>
                            💡 Setup AI provider for smarter queries
                          </span>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={executeQuery}
                        disabled={queryLoading}
                        style={{
                          background: queryLoading ? '#333' : '#4fd1c5',
                          color: queryLoading ? '#666' : '#000',
                          border: 'none',
                          padding: '10px 20px',
                          borderRadius: 6,
                          cursor: queryLoading ? 'not-allowed' : 'pointer',
                          fontSize: 14,
                          fontWeight: 600,
                          transition: 'all 0.2s',
                        }}
                      >
                        {queryLoading ? 'Executing...' : 'Execute Query'} ⚡
                      </button>
                      <span style={{ color: '#666', fontSize: 12 }}>
                        Cmd+Enter to execute
                      </span>
                    </>
                  )}
                </div>

                {/* Example Queries */}
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  <label style={{ color: '#aaa', fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>
                    {nlMode ? 'Example Natural Language Queries:' : 'Example SQL Queries:'}
                  </label>
                  <div style={{ 
                    flex: 1, 
                    overflowY: 'auto',
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: 4,
                    paddingRight: 4,
                    maxHeight: '200px'
                  }}>
                    {(nlMode ? exampleNLQueries : exampleQueries).map((query, idx) => (
                      <button
                        key={idx}
                        onClick={() => nlMode ? setNlInput(query) : setQueryInput(query)}
                        style={{
                          background: 'none',
                          color: '#4fd1c5',
                          border: 'none',
                          padding: '6px 8px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontFamily: nlMode ? 'system-ui, -apple-system, sans-serif' : 'Monaco, Consolas, monospace',
                          borderRadius: 3,
                          transition: 'background 0.2s',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        onMouseEnter={(e) => e.target.style.background = '#222'}
                        onMouseLeave={(e) => e.target.style.background = 'none'}
                        title={query}
                      >
                        {query.length > 50 ? query.substring(0, 50) + '...' : query}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Horizontal Resize Handle - Hidden on mobile */}
              {!isMobile && (
                <div
                  style={{
                    width: 8,
                    cursor: 'ew-resize',
                    background: 'linear-gradient(to right, transparent, #333 50%, transparent)',
                    flexShrink: 0,
                  }}
                  onMouseDown={(e) => {
                    horizontalResizing.current = true;
                    resizeStartX.current = e.clientX;
                    resizeStartWidth.current = leftPanelWidth;
                    e.preventDefault();
                  }}
                />
              )}

              {/* Right Side - Results */}
              <div style={{ 
                flex: isMobile ? 1 : 1,
                display: 'flex', 
                flexDirection: 'column',
                minWidth: isMobile ? 'auto' : '200px',
                minHeight: isMobile ? '300px' : 'auto'
              }}>
                <label style={{ color: '#aaa', fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
                  Query Results:
                </label>

                <div
                  style={{
                    flex: 1,
                    background: '#111',
                    border: '1px solid #333',
                    borderRadius: 6,
                    overflow: 'auto',
                    minHeight: 200,
                  }}
                >
                  {queryError && (
                    <div style={{ padding: 16, color: '#ff6b6b' }}>
                      <strong>Error:</strong> {queryError}
                    </div>
                  )}

                  {queryLoading && (
                    <div style={{ padding: 16, color: '#4fd1c5', textAlign: 'center' }}>
                      Executing query...
                    </div>
                  )}

                  {queryResults && !queryLoading && !queryError && (
                    <div style={{ padding: 16 }}>
                      <div style={{ color: '#4fd1c5', marginBottom: 12, fontSize: 14 }}>
                        <strong>{queryResults.rowCount}</strong> rows returned
                      </div>

                      {queryResults.results && queryResults.results.length > 0 && (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr style={{ background: '#222' }}>
                                {Object.keys(queryResults.results[0]).map((col) => (
                                  <th
                                    key={col}
                                    style={{
                                      padding: '8px 12px',
                                      textAlign: 'left',
                                      color: '#4fd1c5',
                                      borderBottom: '1px solid #333',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {queryResults.results.slice(0, 100).map((row, idx) => (
                                <tr
                                  key={idx}
                                  style={{
                                    background: idx % 2 === 0 ? '#1a1a1a' : 'transparent',
                                  }}
                                >
                                  {Object.values(row).map((value, valueIdx) => (
                                    <td
                                      key={valueIdx}
                                      style={{
                                        padding: '8px 12px',
                                        color: '#fff',
                                        borderBottom: '1px solid #333',
                                        maxWidth: '200px',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                      title={String(value)}
                                    >
                                      {renderEtherscanLink(value)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {queryResults.results.length > 100 && (
                            <div style={{ padding: 12, color: '#666', textAlign: 'center' }}>
                              Showing first 100 rows of {queryResults.rowCount} total results
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {!queryResults && !queryLoading && !queryError && (
                    <div style={{ padding: 16, color: '#666', textAlign: 'center' }}>
                      Enter a SQL query and click Execute to see results
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
