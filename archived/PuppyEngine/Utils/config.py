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
        
        # Validate DEPLOYMENT_TYPE
        deployment_type = os.getenv("DEPLOYMENT_TYPE", "local").lower()
        valid_deployment_types = ["local", "remote"]
        if deployment_type not in valid_deployment_types:
            errors.append(
                f"Invalid DEPLOYMENT_TYPE: '{deployment_type}'. "
                f"Valid values: {', '.join(valid_deployment_types)}"
            )
        
        # If in remote mode, validate required configurations
        if deployment_type == "remote":
            required_remote_configs = {
                "USER_SYSTEM_URL": "User system URL",
                "SERVICE_KEY": "Service key"
            }
            
            for config_key, description in required_remote_configs.items():
                value = os.getenv(config_key)
                if not value or value.strip() == "":
                    errors.append(f"Missing required configuration in remote mode: {config_key} ({description})")
        
        # Validate numeric configurations
        numeric_configs = {
            "AUTH_TIMEOUT": ("Authentication timeout", 1, 60),
            "USAGE_TIMEOUT": ("Usage query timeout", 1, 60),
            "USAGE_MAX_RETRIES": ("Maximum usage query retries", 0, 10),
        }
        
        for config_key, (description, min_val, max_val) in numeric_configs.items():
            value = os.getenv(config_key)
            if value:
                try:
                    num_value = int(value)
                    if not (min_val <= num_value <= max_val):
                        errors.append(
                            f"{config_key} ({description}) value out of range: {num_value}. "
                            f"Valid range: {min_val}-{max_val}"
                        )
                except ValueError:
                    errors.append(f"{config_key} ({description}) must be a number, current value: '{value}'")
        
        # Validate Axiom configuration (optional)
        warnings = []
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
                axiom_validation_failed = False
            else:
                # All Axiom parameters are present, validate connection
                is_valid, error_msg = validate_axiom_connection(axiom_token, axiom_org_id, axiom_dataset)
                if not is_valid:
                    warnings.append(f"Axiom connection validation failed, will use local logging: {error_msg}")
                    axiom_validation_failed = True
                else:
                    axiom_validation_failed = False
        else:
            axiom_validation_failed = False

        # Handle warnings
        if warnings:
            warning_message = "\n".join(f"  ⚠️  {warning}" for warning in warnings)
            print(f"\n⚠️  PuppyEngine configuration warnings:\n{warning_message}\n")

        # If there are errors, throw exception to prevent service startup
        if errors:
            error_message = "Configuration validation failed, service cannot start:\n" + "\n".join(f"  - {error}" for error in errors)
            print(f"\n❌ {error_message}\n")
            raise ConfigValidationError(error_message)
        
        # Print configuration information (for debugging)
        print(f"✅ Configuration validation passed: DEPLOYMENT_TYPE={deployment_type}")
        if deployment_type == "remote":
            user_system_url = os.getenv("USER_SYSTEM_URL", "not set")
            print(f"   USER_SYSTEM_URL={user_system_url}")
            print(f"   SERVICE_KEY={'configured' if os.getenv('SERVICE_KEY') else 'not set'}")
        
        # Print Axiom status
        if axiom_token and axiom_org_id and axiom_dataset and not axiom_validation_failed:
            print(f"   Axiom logging: configured and verified")
        elif axiom_token and axiom_org_id and axiom_dataset and axiom_validation_failed:
            print(f"   Axiom logging: configured but connection failed, using local logging")
        else:
            print(f"   Logging mode: local")

    def get(self, key: str, default=None):
        return os.getenv(key, default)

# Singleton configuration instance
config = AppConfig()
