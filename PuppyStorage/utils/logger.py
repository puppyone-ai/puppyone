import logging
from axiom_py import Client
from utils.config import config

logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)

# Initialize Axiom client for logging
axiom_client = Client(
    config.get("AXIOM_TOKEN"),
    config.get("AXIOM_ORG_ID")
)

AXIOM_TOKEN = config.get("AXIOM_TOKEN")
AXIOM_ORG_ID = config.get("AXIOM_ORG_ID")
AXIOM_DATASET = config.get("AXIOM_DATASET")

def log_info(
    message: any
):
    try:
        axiom_client.ingest_events(AXIOM_DATASET, [{"level": "INFO", "message": message}])
        logger.info(message)
    except Exception as e:
        logger.error(f"Failed to log to Axiom: {e}")

def log_error(
    message: any
):
    try:
        axiom_client.ingest_events(AXIOM_DATASET, [{"level": "ERROR", "message": message}])
        logger.error(message)
    except Exception as e:
        logger.error(f"Failed to log to Axiom: {e}")


def log_warning(
    message: any
):
    try:
        axiom_client.ingest_events(AXIOM_DATASET, [{"level": "WARNING", "message": message}])
        logger.warning(message)
    except Exception as e:
        logger.error(f"Failed to log to Axiom: {e}")
