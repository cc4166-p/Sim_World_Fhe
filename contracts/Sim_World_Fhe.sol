pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SimWorldFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds = 60;

    bool public paused;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    uint256 public currentBatchId;
    bool public batchOpen;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused();
    event Unpaused();
    event CooldownSet(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 batchId);
    event BatchClosed(uint256 batchId);
    event DataSubmitted(address indexed provider, uint256 batchId, bytes32 encryptedData);
    event DecryptionRequested(uint256 indexed requestId, uint256 batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 batchId, uint256 decryptedValue);

    error NotOwner();
    error NotProvider();
    error PausedError();
    error CooldownActive();
    error BatchClosedError();
    error ReplayError();
    error StateMismatchError();
    error InvalidProofError();
    error NotInitializedError();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    modifier checkCooldownSubmission() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkCooldownDecryption() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        isProvider[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        delete isProvider[provider];
        emit ProviderRemoved(provider);
    }

    function setPaused(bool _paused) external onlyOwner {
        if (_paused) {
            paused = true;
            emit Paused();
        } else {
            paused = false;
            emit Unpaused();
        }
    }

    function setCooldown(uint256 newCooldown) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldown;
        emit CooldownSet(oldCooldown, newCooldown);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) {
            currentBatchId++;
        }
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchClosedError();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitEncryptedData(euint32 encryptedData) external onlyProvider whenNotPaused checkCooldownSubmission {
        if (!batchOpen) revert BatchClosedError();
        lastSubmissionTime[msg.sender] = block.timestamp;

        // Store encrypted data in a mapping, keyed by batchId and provider
        // For simplicity, this example stores one value per provider per batch.
        // A real system might use a more complex data structure.
        // This contract doesn't actually use this stored data for FHE ops in this example,
        // but it demonstrates where it would go.
        // The FHE operations below use a hardcoded value for demonstration.

        emit DataSubmitted(msg.sender, currentBatchId, encryptedData.toBytes32());
    }

    function requestAggregateDecryption() external whenNotPaused checkCooldownDecryption {
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        euint32 constant INITIAL_VALUE = euint32.wrap(0); // Placeholder for actual aggregated state
        euint32 encryptedResult = _computeEncryptedAggregate(INITIAL_VALUE);

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = encryptedResult.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });

        emit DecryptionRequested(requestId, currentBatchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayError();

        // Rebuild ciphertexts array in the exact same order as in requestAggregateDecryption
        euint32 constant INITIAL_VALUE = euint32.wrap(0); // Must match the computation in requestAggregateDecryption
        euint32 encryptedResult = _computeEncryptedAggregate(INITIAL_VALUE);
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = encryptedResult.toBytes32();

        // State Verification: Ensure the state hasn't changed since the request
        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatchError();
        }

        // Proof Verification
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert InvalidProofError();
        }

        // Decode & Finalize
        uint256 decryptedValue = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, decryptedValue);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 value) internal {
        if (!value.isInitialized()) {
            revert NotInitializedError();
        }
    }

    function _computeEncryptedAggregate(euint32 encryptedCurrentValue) internal view returns (euint32) {
        _initIfNeeded(encryptedCurrentValue);

        // This is a placeholder for complex FHE logic.
        // In a real "Sim_World_Fhe", this would involve:
        // 1. Fetching multiple encrypted state variables from storage.
        // 2. Performing FHE operations (add, mul, ge, le, eq) on them.
        // 3. Producing a final encrypted result to be decrypted.
        // For this example, we just return the input, or perform a simple operation.
        // Example: Add 1 to the encrypted value (if it were a counter)
        // euint32 encryptedOne = FHE.asEuint32(1);
        // return encryptedCurrentValue.add(encryptedOne);

        // For now, let's just return the input as the "aggregate"
        return encryptedCurrentValue;
    }
}