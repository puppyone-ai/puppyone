"""
Logging Module

Provides a flexible logging system that supports both local and remote (Axiom) logging.
"""

import logging
import warnings

from axiom_py import Client

from Utils.config import config

# Get log level from environment variable, default to INFO
log_level_str = config.get("LOG_LEVEL", "INFO").upper()
log_level = getattr(logging, log_level_str, logging.INFO)

# Configure basic logging
logging.basicConfig(level=log_level)
logging.getLogger("httpx").setLevel(logging.ERROR)

class Logger:
    """
    Flexible logging class supporting dual-mode operation
    
    Modes:
        - default: Logs to both Axiom (remote) and local terminal
        - local: Logs only to local terminal
    """
    logger_name = "puppyengine"
    
    def __init__(self, mode="default"):
        """
        Initialize Logger instance
        
        Args:
            mode: Logging mode ("default" or "local")
        """
        self.mode = mode
        self.logger = logging.getLogger(self.__class__.logger_name)
        
        # Set the logging handler based on the mode
        if mode == "default":
            # Suppress specific warning types in default mode
            warnings.simplefilter("ignore", DeprecationWarning)
            warnings.simplefilter("ignore", UserWarning)
            warnings.simplefilter("ignore", FutureWarning)

            # Initialize Axiom client for remote logging
            self.axiom_token = config.get("AXIOM_TOKEN")
            self.axiom_org_id = config.get("AXIOM_ORG_ID")
            self.axiom_dataset = config.get("AXIOM_DATASET")
            
            if self.axiom_token and self.axiom_org_id and self.axiom_dataset:
                try:
                    self.axiom_client = Client(self.axiom_token, self.axiom_org_id)
                    self._log_handler = self._log_with_axiom
                except Exception as e:
                    self.logger.error(f"Failed to initialize Axiom client: {e}")
                    self._log_handler = self._log_local
            else:
                self.logger.warning("Axiom configuration incomplete, using local logging only")
                self._log_handler = self._log_local
        else:
            self._log_handler = self._log_local
    
    def _log_local(self, level, message):
        """Log to local terminal only"""
        log_method = getattr(self.logger, level.lower())
        log_method(message)
    
    def _log_with_axiom(self, level, message):
        """Log to both local terminal and Axiom remote service"""
        log_method = getattr(self.logger, level.lower())
        log_method(message)
        
        try:
            self.axiom_client.ingest_events(
                self.axiom_dataset,
                [{"level": level, "message": str(message)}]
            )
        except Exception as e:
            self.logger.error(f"Failed to send logs to Axiom: {e}")
    
    def info(self, message):
        """Log info level message"""
        self._log_handler("INFO", message)
    
    def error(self, message):
        """Log error level message"""
        self._log_handler("ERROR", message)
    
    def warning(self, message):
        """Log warning level message"""
        self._log_handler("WARNING", message)

    def debug(self, message):
        """Log debug level message"""
        self._log_handler("DEBUG", message)


# Default logger instance (backward compatibility)
default_logger = Logger("local")
log_info = default_logger.info
log_error = default_logger.error
log_warning = default_logger.warning
log_debug = default_logger.debug
