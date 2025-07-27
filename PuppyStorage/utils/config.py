import os
from pathlib import Path
from dotenv import load_dotenv

def validate_axiom_connection(axiom_token, axiom_org_id, axiom_dataset):
    """
    Validate Axiom connection by attempting to connect and perform a simple operation
    
    Args:
        axiom_token: Axiom API token
        axiom_org_id: Axiom organization ID
        axiom_dataset: Axiom dataset name
        
    Returns:
        tuple: (is_valid: bool, error_message: str or None)
    """
    try:
        from axiom_py import Client
        
        # Initialize Axiom client
        client = Client(axiom_token, axiom_org_id)
        
        # Try to verify connection by listing datasets or getting dataset info
        try:
            # Attempt to get dataset information to verify both connection and dataset existence
            dataset_info = client.datasets.get(axiom_dataset)
            if dataset_info:
                return True, None
            else:
                return False, f"Dataset '{axiom_dataset}' not found"
        except Exception as dataset_error:
            # If getting specific dataset fails, try listing all datasets to verify connection
            try:
                client.datasets.list()
                return False, f"Connection successful but dataset '{axiom_dataset}' is not accessible: {str(dataset_error)}"
            except Exception:
                # If listing datasets also fails, it's likely a connection/auth issue
                raise dataset_error
                
    except ImportError:
        return False, "axiom_py package not installed"
    except Exception as e:
        error_msg = str(e)
        # Provide more specific error messages for common issues
        if "authentication" in error_msg.lower() or "unauthorized" in error_msg.lower():
            return False, f"Authentication failed - please check AXIOM_TOKEN and AXIOM_ORG_ID: {error_msg}"
        elif "network" in error_msg.lower() or "connection" in error_msg.lower():
            return False, f"Network connection failed - please check internet connectivity: {error_msg}"
        else:
            return False, f"Axiom connection failed: {error_msg}"

class ConfigValidationError(Exception):
    """Configuration validation error"""
    pass

# Define project critical paths
class PathManager:
    _instance = None
    
    def __new__(cls):
        if not cls._instance:
            cls._instance = super().__new__(cls)
            cls._instance._init_paths()
        return cls._instance
    
    def _init_paths(self):
        """Initialize and calculate project critical paths"""
        # Project root directory (PuppyAgent-Jack)
        self.PROJECT_ROOT = Path(__file__).parent.parent.parent
        
        # Storage root directory
        self.STORAGE_ROOT = self.get_path("LOCAL_STORAGE_PATH", 
                                          os.path.join(str(self.PROJECT_ROOT), "local_storage"))
        
        # Ensure storage directory exists
        os.makedirs(self.STORAGE_ROOT, exist_ok=True)
    
    def get_path(self, env_key=None, default=None):
        """
        Get path, prioritizing environment variables, then using default values
        
        Args:
            env_key: Environment variable key name
            default: Default path
            
        Returns:
            Resolved path string
        """
        if env_key and os.getenv(env_key):
            return os.getenv(env_key)
        return default

# Path manager instance
paths = PathManager()

class AppConfig:
    _instance = None
    
    def __new__(cls):
        if not cls._instance:
            cls._instance = super().__new__(cls)
            cls._instance._load()
        return cls._instance
    
    def _load(self):
        # Load .env file (if exists), but don't override existing environment variables
        # This way environment variables from platforms like Railway maintain higher priority
        env_path = Path(__file__).parent.parent / ".env"
        load_dotenv(env_path, override=False)
        
        # Validate critical configuration items
        self._validate_config()
    
    def _validate_config(self):
        """Validate the validity of critical configuration items"""
        errors = []
        warnings = []
        
        # Validate access permissions for critical paths
        critical_paths = {
            "PROJECT_ROOT": paths.PROJECT_ROOT,
            "STORAGE_ROOT": paths.STORAGE_ROOT
        }
        
        for path_name, path_value in critical_paths.items():
            if not path_value:
                errors.append(f"Critical path not set: {path_name}")
                continue
                
            path_obj = Path(path_value)
            
            # Check if path exists
            if not path_obj.exists():
                try:
                    path_obj.mkdir(parents=True, exist_ok=True)
                    warnings.append(f"Auto-created directory: {path_name} -> {path_value}")
                except Exception as e:
                    errors.append(f"Unable to create directory {path_name} ({path_value}): {str(e)}")
                    continue
            
            # Check read/write permissions
            if not os.access(path_value, os.R_OK):
                errors.append(f"Path not readable: {path_name} ({path_value})")
            
            if not os.access(path_value, os.W_OK):
                errors.append(f"Path not writable: {path_name} ({path_value})")
        
        # Validate Axiom configuration (optional)
        axiom_token = os.getenv("AXIOM_TOKEN")
        axiom_org_id = os.getenv("AXIOM_ORG_ID") 
        axiom_dataset = os.getenv("AXIOM_DATASET")
        
        if any([axiom_token, axiom_org_id, axiom_dataset]):
            # If any Axiom parameters are configured, check completeness
            missing_axiom = []
            if not axiom_token:
                missing_axiom.append("AXIOM_TOKEN")
            if not axiom_org_id:
                missing_axiom.append("AXIOM_ORG_ID")
            if not axiom_dataset:
                missing_axiom.append("AXIOM_DATASET")
            
            if missing_axiom:
                warnings.append(
                    f"Incomplete Axiom configuration, will use local logging: missing {', '.join(missing_axiom)}"
                )
            else:
                # All Axiom parameters are present, validate connection
                is_valid, error_msg = validate_axiom_connection(axiom_token, axiom_org_id, axiom_dataset)
                if not is_valid:
                    warnings.append(f"Axiom connection validation failed, will use local logging: {error_msg}")
                    # Set a flag to indicate Axiom validation failed (for print statements later)
                    axiom_validation_failed = True
                else:
                    axiom_validation_failed = False
        else:
            axiom_validation_failed = False
        
        # Validate numeric configurations
        numeric_configs = {
            "STORAGE_MAX_SIZE_GB": ("Maximum storage capacity (GB)", 1, 1000),
            "CLEANUP_INTERVAL_HOURS": ("Cleanup interval (hours)", 1, 168),  # 1 hour to 1 week
        }
        
        for config_key, (description, min_val, max_val) in numeric_configs.items():
            value = os.getenv(config_key)
            if value:
                try:
                    num_value = float(value)
                    if not (min_val <= num_value <= max_val):
                        warnings.append(
                            f"{config_key} ({description}) value exceeds recommended range: {num_value}. "
                            f"Recommended range: {min_val}-{max_val}"
                        )
                except ValueError:
                    warnings.append(f"{config_key} ({description}) should be a number, current value: '{value}'")
        
        # Handle errors
        if errors:
            error_message = "PuppyStorage configuration validation failed, service cannot start:\n" + "\n".join(f"  - {error}" for error in errors)
            print(f"\n❌ {error_message}\n")
            raise ConfigValidationError(error_message)
        
        # Handle warnings
        if warnings:
            warning_message = "\n".join(f"  ⚠️  {warning}" for warning in warnings)
            print(f"\n⚠️  PuppyStorage configuration warnings:\n{warning_message}\n")
        
        # Print configuration information (for debugging)
        print(f"✅ PuppyStorage configuration validation passed")
        print(f"   PROJECT_ROOT={paths.PROJECT_ROOT}")
        print(f"   STORAGE_ROOT={paths.STORAGE_ROOT}")
        if axiom_token and axiom_org_id and axiom_dataset and not axiom_validation_failed:
            print(f"   Axiom logging: configured and verified")
        elif axiom_token and axiom_org_id and axiom_dataset and axiom_validation_failed:
            print(f"   Axiom logging: configured but connection failed, using local logging")
        else:
            print(f"   Logging mode: local")
    
    def get(self, key: str, default=None):
        return os.getenv(key, default)
    
    def get_path(self, path_key: str):
        """
        Get predefined project paths
        
        Args:
            path_key: Path key name, such as PROJECT_ROOT, STORAGE_ROOT, etc.
            
        Returns:
            Corresponding path string, returns None if not exists
        """
        return getattr(paths, path_key, None)

# Singleton configuration instance
config = AppConfig() 