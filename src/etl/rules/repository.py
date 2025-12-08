"""
ETL Rule Repository

Manages storage and retrieval of ETL transformation rules.
"""

import json
import logging
import uuid
from datetime import datetime, UTC
from pathlib import Path
from typing import Optional

from src.etl.rules.schemas import ETLRule, RuleCreateRequest, RuleUpdateRequest

logger = logging.getLogger(__name__)


class RuleRepository:
    """Repository for ETL transformation rules (file-based storage)."""

    def __init__(self, rules_dir: str = ".etl_rules"):
        """
        Initialize rule repository.

        Args:
            rules_dir: Directory for storing rule files
        """
        self.rules_dir = Path(rules_dir)
        self.rules_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"RuleRepository initialized with directory: {self.rules_dir}")

    def create_rule(self, request: RuleCreateRequest) -> ETLRule:
        """
        Create a new ETL rule.

        Args:
            request: Rule creation request

        Returns:
            Created ETLRule
        """
        # Generate unique rule ID
        rule_id = str(uuid.uuid4())

        rule = ETLRule(
            rule_id=rule_id,
            name=request.name,
            description=request.description,
            json_schema=request.json_schema,
            system_prompt=request.system_prompt,
        )

        # Save to file
        self._save_rule(rule)

        logger.info(f"Created rule: {rule.name} (rule_id: {rule_id})")
        return rule

    def get_rule(self, rule_id: str) -> Optional[ETLRule]:
        """
        Get a rule by ID.

        Args:
            rule_id: Rule identifier

        Returns:
            ETLRule if found, None otherwise
        """
        rule_path = self.rules_dir / f"{rule_id}.json"

        if not rule_path.exists():
            logger.warning(f"Rule not found: {rule_id}")
            return None

        with open(rule_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        return ETLRule(**data)

    def update_rule(self, rule_id: str, request: RuleUpdateRequest) -> Optional[ETLRule]:
        """
        Update an existing rule.

        Args:
            rule_id: Rule identifier
            request: Update request

        Returns:
            Updated ETLRule if found, None otherwise
        """
        rule = self.get_rule(rule_id)
        if not rule:
            return None

        # Update fields if provided
        if request.name is not None:
            rule.name = request.name
        if request.description is not None:
            rule.description = request.description
        if request.json_schema is not None:
            rule.json_schema = request.json_schema
        if request.system_prompt is not None:
            rule.system_prompt = request.system_prompt

        rule.updated_at = datetime.now(UTC)

        # Save updated rule
        self._save_rule(rule)

        logger.info(f"Updated rule: {rule_id}")
        return rule

    def delete_rule(self, rule_id: str) -> bool:
        """
        Delete a rule.

        Args:
            rule_id: Rule identifier

        Returns:
            True if deleted, False if not found
        """
        rule_path = self.rules_dir / f"{rule_id}.json"

        if not rule_path.exists():
            logger.warning(f"Rule not found for deletion: {rule_id}")
            return False

        rule_path.unlink()
        logger.info(f"Deleted rule: {rule_id}")
        return True

    def list_rules(self, limit: int = 100, offset: int = 0) -> list[ETLRule]:
        """
        List all rules with pagination.

        Args:
            limit: Maximum number of rules to return
            offset: Number of rules to skip

        Returns:
            List of ETLRule objects
        """
        rule_files = sorted(self.rules_dir.glob("*.json"))

        # Apply pagination
        paginated_files = rule_files[offset:offset + limit]

        rules = []
        for rule_file in paginated_files:
            try:
                with open(rule_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                rules.append(ETLRule(**data))
            except Exception as e:
                logger.error(f"Error loading rule from {rule_file}: {e}")
                continue

        logger.info(f"Listed {len(rules)} rules (offset={offset}, limit={limit})")
        return rules

    def count_rules(self) -> int:
        """
        Count total number of rules.

        Returns:
            Total rule count
        """
        return len(list(self.rules_dir.glob("*.json")))

    def _save_rule(self, rule: ETLRule) -> None:
        """
        Save rule to file.

        Args:
            rule: Rule to save
        """
        rule_path = self.rules_dir / f"{rule.rule_id}.json"

        with open(rule_path, "w", encoding="utf-8") as f:
            json.dump(rule.model_dump(mode="json"), f, indent=2, ensure_ascii=False)

        logger.debug(f"Saved rule to {rule_path}")

