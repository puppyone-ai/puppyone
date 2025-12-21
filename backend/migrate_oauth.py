#!/usr/bin/env python3
"""
Database migration script for oauth_connection table
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Add the src directory to the Python path
sys.path.insert(0, str(Path(__file__).parent))

from src.supabase.client import SupabaseClient

def read_sql_file(file_path: str) -> str:
    """Read SQL file content"""
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()

def execute_migration():
    """Execute the oauth_connection table migration"""
    try:
        # Initialize Supabase client
        client = SupabaseClient().get_client()

        # Read SQL file
        sql_file = Path(__file__).parent / "sql" / "oauth_connection.sql"
        sql_content = read_sql_file(str(sql_file))

        print("🚀 Starting oauth_connection table migration...")

        # Execute SQL using Supabase RPC
        # Note: Supabase doesn't directly support executing arbitrary SQL via the client,
        # so we'll use the RPC functionality if available, or split into individual statements

        # Split SQL into individual statements
        statements = [stmt.strip() for stmt in sql_content.split(';') if stmt.strip()]

        for i, statement in enumerate(statements, 1):
            if statement:
                print(f"Executing statement {i}/{len(statements)}...")
                try:
                    # Try to execute as raw SQL (this might not work with Supabase client)
                    # In many cases, you need to execute this via Supabase dashboard or direct SQL
                    client.rpc('exec_sql', {'sql': statement}).execute()
                    print(f"✅ Statement {i} executed successfully")
                except Exception as e:
                    print(f"⚠️  Statement {i} failed: {str(e)}")
                    print("   You may need to execute this manually in Supabase dashboard")
                    print(f"   SQL: {statement[:100]}...")

        print("🎉 Migration completed!")
        print("\n⚠️  IMPORTANT NOTE:")
        print("If the SQL execution failed, please manually execute the oauth_connection.sql")
        print("file in your Supabase dashboard SQL editor.")

    except Exception as e:
        print(f"❌ Migration failed: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    execute_migration()