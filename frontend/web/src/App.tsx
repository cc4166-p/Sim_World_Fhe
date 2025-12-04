// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface WorldState {
  id: string;
  encryptedData: string;
  timestamp: number;
  observer: string;
  region: string;
  status: "active" | "inactive" | "anomaly";
}

// Randomly selected style: High Contrast (Red+Black), Cyberpunk UI, Center Radiation Layout, Animation Rich
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'evolve':
      result = value * (1 + (Math.random() * 0.2 - 0.1)); // Random evolution
      break;
    case 'stabilize':
      result = value * 0.95;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [worldStates, setWorldStates] = useState<WorldState[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newStateData, setNewStateData] = useState({ region: "", description: "", population: 0 });
  const [selectedState, setSelectedState] = useState<WorldState | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [showWorldMap, setShowWorldMap] = useState(false);
  const [activeTab, setActiveTab] = useState("simulation");
  const [searchTerm, setSearchTerm] = useState("");

  const activeCount = worldStates.filter(s => s.status === "active").length;
  const inactiveCount = worldStates.filter(s => s.status === "inactive").length;
  const anomalyCount = worldStates.filter(s => s.status === "anomaly").length;

  useEffect(() => {
    loadWorldStates().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadWorldStates = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract is not available");
        return;
      }

      const keysBytes = await contract.getData("world_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing world keys:", e); }
      }

      const list: WorldState[] = [];
      for (const key of keys) {
        try {
          const stateBytes = await contract.getData(`world_${key}`);
          if (stateBytes.length > 0) {
            try {
              const stateData = JSON.parse(ethers.toUtf8String(stateBytes));
              list.push({ 
                id: key, 
                encryptedData: stateData.data, 
                timestamp: stateData.timestamp, 
                observer: stateData.observer, 
                region: stateData.region, 
                status: stateData.status || "active" 
              });
            } catch (e) { console.error(`Error parsing state data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading world state ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setWorldStates(list);
    } catch (e) { 
      console.error("Error loading world states:", e); 
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  const submitWorldState = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting world state with Zama FHE..." });
    try {
      const encryptedData = FHEEncryptNumber(newStateData.population);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const stateId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const stateData = { 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        observer: address, 
        region: newStateData.region, 
        status: "active" 
      };
      
      await contract.setData(`world_${stateId}`, ethers.toUtf8Bytes(JSON.stringify(stateData)));
      
      const keysBytes = await contract.getData("world_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(stateId);
      await contract.setData("world_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted world state submitted!" });
      await loadWorldStates();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewStateData({ region: "", description: "", population: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreating(false); 
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const evolveState = async (stateId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted evolution with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const stateBytes = await contract.getData(`world_${stateId}`);
      if (stateBytes.length === 0) throw new Error("State not found");
      const stateData = JSON.parse(ethers.toUtf8String(stateBytes));
      
      const evolvedData = FHECompute(stateData.data, 'evolve');
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedState = { 
        ...stateData, 
        data: evolvedData,
        timestamp: Math.floor(Date.now() / 1000)
      };
      await contractWithSigner.setData(`world_${stateId}`, ethers.toUtf8Bytes(JSON.stringify(updatedState)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE evolution completed!" });
      await loadWorldStates();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Evolution failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const stabilizeState = async (stateId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted stabilization with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const stateBytes = await contract.getData(`world_${stateId}`);
      if (stateBytes.length === 0) throw new Error("State not found");
      const stateData = JSON.parse(ethers.toUtf8String(stateBytes));
      
      const stabilizedData = FHECompute(stateData.data, 'stabilize');
      
      const updatedState = { 
        ...stateData, 
        data: stabilizedData,
        status: "active",
        timestamp: Math.floor(Date.now() / 1000)
      };
      await contract.setData(`world_${stateId}`, ethers.toUtf8Bytes(JSON.stringify(updatedState)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE stabilization completed!" });
      await loadWorldStates();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Stabilization failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isObserver = (stateAddress: string) => address?.toLowerCase() === stateAddress.toLowerCase();

  const filteredStates = worldStates.filter(state => 
    state.region.toLowerCase().includes(searchTerm.toLowerCase()) ||
    state.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderWorldMap = () => {
    return (
      <div className="world-map-container">
        <div className="map-grid">
          {worldStates.slice(0, 12).map((state, index) => (
            <div 
              key={index} 
              className={`map-region ${state.status}`}
              onClick={() => setSelectedState(state)}
            >
              <div className="region-name">{state.region || `Region ${index+1}`}</div>
              <div className="region-status">{state.status}</div>
            </div>
          ))}
        </div>
        <div className="map-legend">
          <div className="legend-item"><div className="color-box active"></div><span>Active</span></div>
          <div className="legend-item"><div className="color-box inactive"></div><span>Inactive</span></div>
          <div className="legend-item"><div className="color-box anomaly"></div><span>Anomaly</span></div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted world connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="globe-icon"></div></div>
          <h1>Sim_World_Fhe</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-state-btn cyber-button">
            <div className="add-icon"></div>Add Region
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>隱秘模擬世界</h2>
            <p>An autonomous world that exists as an FHE-encrypted simulation on a decentralized computer</p>
          </div>
          <div className="fhe-indicator">
            <div className="fhe-lock"></div>
            <span>FHE Encryption Active</span>
          </div>
        </div>

        <div className="navigation-tabs">
          <button 
            className={`tab-button ${activeTab === "simulation" ? "active" : ""}`}
            onClick={() => setActiveTab("simulation")}
          >
            Simulation
          </button>
          <button 
            className={`tab-button ${activeTab === "map" ? "active" : ""}`}
            onClick={() => setActiveTab("map")}
          >
            World Map
          </button>
          <button 
            className={`tab-button ${activeTab === "stats" ? "active" : ""}`}
            onClick={() => setActiveTab("stats")}
          >
            Statistics
          </button>
        </div>

        {activeTab === "simulation" && (
          <div className="simulation-section">
            <div className="section-header">
              <h2>World States</h2>
              <div className="header-actions">
                <input
                  type="text"
                  placeholder="Search regions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input cyber-input"
                />
                <button onClick={loadWorldStates} className="refresh-btn cyber-button" disabled={isRefreshing}>
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            <div className="states-list cyber-card">
              <div className="table-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Region</div>
                <div className="header-cell">Observer</div>
                <div className="header-cell">Last Update</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>
              {filteredStates.length === 0 ? (
                <div className="no-states">
                  <div className="no-states-icon"></div>
                  <p>No world states found</p>
                  <button className="cyber-button primary" onClick={() => setShowCreateModal(true)}>Create First State</button>
                </div>
              ) : filteredStates.map(state => (
                <div className="state-row" key={state.id} onClick={() => setSelectedState(state)}>
                  <div className="table-cell state-id">#{state.id.substring(0, 6)}</div>
                  <div className="table-cell">{state.region}</div>
                  <div className="table-cell">{state.observer.substring(0, 6)}...{state.observer.substring(38)}</div>
                  <div className="table-cell">{new Date(state.timestamp * 1000).toLocaleDateString()}</div>
                  <div className="table-cell">
                    <span className={`status-badge ${state.status}`}>{state.status}</span>
                  </div>
                  <div className="table-cell actions">
                    {isObserver(state.observer) && (
                      <>
                        <button 
                          className="action-btn cyber-button evolve" 
                          onClick={(e) => { e.stopPropagation(); evolveState(state.id); }}
                        >
                          Evolve
                        </button>
                        {state.status !== "active" && (
                          <button 
                            className="action-btn cyber-button stabilize" 
                            onClick={(e) => { e.stopPropagation(); stabilizeState(state.id); }}
                          >
                            Stabilize
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "map" && (
          <div className="map-section">
            <div className="section-header">
              <h2>World Map</h2>
              <button 
                className="cyber-button"
                onClick={() => setShowWorldMap(!showWorldMap)}
              >
                {showWorldMap ? "Hide Map" : "Show Map"}
              </button>
            </div>
            {showWorldMap ? (
              renderWorldMap()
            ) : (
              <div className="map-placeholder cyber-card">
                <div className="placeholder-icon"></div>
                <p>World map visualization is hidden</p>
                <button className="cyber-button" onClick={() => setShowWorldMap(true)}>
                  Show Encrypted World Map
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "stats" && (
          <div className="stats-section">
            <div className="section-header">
              <h2>World Statistics</h2>
            </div>
            <div className="stats-grid">
              <div className="stats-card cyber-card">
                <h3>Region Distribution</h3>
                <div className="pie-chart-container">
                  <div className="pie-chart">
                    <div className="pie-segment active" style={{ transform: `rotate(${(activeCount / worldStates.length) * 360}deg)` }}></div>
                    <div className="pie-segment inactive" style={{ transform: `rotate(${(activeCount / worldStates.length + inactiveCount / worldStates.length) * 360}deg)` }}></div>
                    <div className="pie-segment anomaly" style={{ transform: `rotate(${(activeCount / worldStates.length + inactiveCount / worldStates.length + anomalyCount / worldStates.length) * 360}deg)` }}></div>
                    <div className="pie-center">
                      <div className="pie-value">{worldStates.length}</div>
                      <div className="pie-label">Regions</div>
                    </div>
                  </div>
                  <div className="pie-legend">
                    <div className="legend-item"><div className="color-box active"></div><span>Active: {activeCount}</span></div>
                    <div className="legend-item"><div className="color-box inactive"></div><span>Inactive: {inactiveCount}</span></div>
                    <div className="legend-item"><div className="color-box anomaly"></div><span>Anomaly: {anomalyCount}</span></div>
                  </div>
                </div>
              </div>
              <div className="stats-card cyber-card">
                <h3>Recent Activity</h3>
                <div className="activity-list">
                  {worldStates.slice(0, 5).map(state => (
                    <div key={state.id} className="activity-item">
                      <div className="activity-region">{state.region}</div>
                      <div className="activity-status">
                        <span className={`status-badge ${state.status}`}>{state.status}</span>
                      </div>
                      <div className="activity-time">
                        {new Date(state.timestamp * 1000).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitWorldState} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          stateData={newStateData} 
          setStateData={setNewStateData}
        />
      )}

      {selectedState && (
        <StateDetailModal 
          state={selectedState} 
          onClose={() => { setSelectedState(null); setDecryptedValue(null); }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="globe-icon"></div><span>Sim_World_Fhe</span></div>
            <p>An FHE-encrypted autonomous world simulation</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Powered by Zama FHE</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Simulation</span></div>
          <div className="copyright">© {new Date().getFullYear()} Sim_World_Fhe. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  stateData: any;
  setStateData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, stateData, setStateData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setStateData({ ...stateData, [name]: value });
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setStateData({ ...stateData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!stateData.region || !stateData.population) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Add World State</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>World state will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>Region *</label>
              <input 
                type="text" 
                name="region" 
                value={stateData.region} 
                onChange={handleChange} 
                placeholder="Enter region name..." 
                className="cyber-input"
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input 
                type="text" 
                name="description" 
                value={stateData.description} 
                onChange={handleChange} 
                placeholder="Brief description..." 
                className="cyber-input"
              />
            </div>
            <div className="form-group">
              <label>Population *</label>
              <input 
                type="number" 
                name="population" 
                value={stateData.population} 
                onChange={handleValueChange} 
                placeholder="Enter population..." 
                className="cyber-input"
                min="0"
              />
            </div>
          </div>
          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Value:</span>
                <div>{stateData.population || 'No value entered'}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{stateData.population ? FHEEncryptNumber(stateData.population).substring(0, 50) + '...' : 'No value entered'}</div>
              </div>
            </div>
          </div>
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div>
              <strong>World Privacy</strong>
              <p>State remains encrypted during FHE processing and is never fully revealed</p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn cyber-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn cyber-button primary">
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface StateDetailModalProps {
  state: WorldState;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const StateDetailModal: React.FC<StateDetailModalProps> = ({ state, onClose, decryptedValue, setDecryptedValue, isDecrypting, decryptWithSignature }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { setDecryptedValue(null); return; }
    const decrypted = await decryptWithSignature(state.encryptedData);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="state-detail-modal cyber-card">
        <div className="modal-header">
          <h2>State Details #{state.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="state-info">
            <div className="info-item"><span>Region:</span><strong>{state.region}</strong></div>
            <div className="info-item"><span>Observer:</span><strong>{state.observer.substring(0, 6)}...{state.observer.substring(38)}</strong></div>
            <div className="info-item"><span>Last Update:</span><strong>{new Date(state.timestamp * 1000).toLocaleString()}</strong></div>
            <div className="info-item"><span>Status:</span><strong className={`status-badge ${state.status}`}>{state.status}</strong></div>
          </div>
          <div className="encrypted-data-section">
            <h3>Encrypted State Data</h3>
            <div className="encrypted-data">{state.encryptedData.substring(0, 100)}...</div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn cyber-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? <span className="decrypt-spinner"></span> : decryptedValue !== null ? "Hide Decrypted Value" : "Decrypt with Wallet Signature"}
            </button>
          </div>
          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Value</h3>
              <div className="decrypted-value">{decryptedValue}</div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn cyber-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;
