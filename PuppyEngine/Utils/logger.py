import logging
import warnings
from axiom_py import Client
from Utils.config import config


# Configure basic logging
logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.ERROR)

class Logger:
    """
    Optimized logging class supporting two modes:
    - default: logs to both Axiom and terminal
    - local: logs only to terminal
    """
    logger_name = "puppyengine"
    
    def __init__(self, mode="default"):
        """Initialize Logger instance"""
        self.mode = mode
        self.logger = logging.getLogger(self.__class__.logger_name)
        
        # Set the logging handler based on the mode
        if mode == "default":

            # only ignore specific warning types in default mode
            warnings.simplefilter("ignore", DeprecationWarning)
            warnings.simplefilter("ignore", UserWarning)
            warnings.simplefilter("ignore", FutureWarning)

            # Initialize the Axiom client
            self.axiom_token = config.get("AXIOM_TOKEN")
            self.axiom_org_id = config.get("AXIOM_ORG_ID")
            self.axiom_dataset = config.get("AXIOM_DATASET")
            
            if self.axiom_token and self.axiom_org_id and self.axiom_dataset:
                try:
                    self.axiom_client = Client(
                        self.axiom_token,
                        self.axiom_org_id
                    )
                    # If the Axiom client is successfully initialized, use the remote logging handler
                    self._log_handler = self._log_with_axiom
                except Exception as e:
                    self.logger.error(f"Failed to initialize Axiom client: {e}")
                    self._log_handler = self._log_local
            else:
                self.logger.warning("Axiom configuration is incomplete, using local logging only")
                self._log_handler = self._log_local
        else:
            # Local mode, only use local logging
            self._log_handler = self._log_local
    
    def _log_local(self, level, message):
        """Only record local logs"""
        log_method = getattr(self.logger, level.lower())
        log_method(message)
    
    def _log_with_axiom(self, level, message):
        """Record local logs and send to Axiom"""
        # First record local logs
        log_method = getattr(self.logger, level.lower())
        log_method(message)
        
        # Then send to Axiom
        try:
            self.axiom_client.ingest_events(
                self.axiom_dataset, 
                [{"level": level, "message": str(message)}]
            )
        except Exception as e:
            self.logger.error(f"Failed to send logs to Axiom: {e}")
    
    def info(self, message):
        """Record info level logs"""
        self._log_handler("INFO", message)
    
    def error(self, message):
        """Record error level logs"""
        self._log_handler("ERROR", message)
    
    def warning(self, message):
        """Record warning level logs"""
        self._log_handler("WARNING", message)


# Create default instance (backward compatibility)
default_logger = Logger("default")
log_info = default_logger.info
log_error = default_logger.error
log_warning = default_logger.warning