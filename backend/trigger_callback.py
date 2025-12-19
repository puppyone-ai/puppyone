import asyncio
import sys
sys.path.insert(0, '/home/hv/projs/PuppyContext/backend')

from src.etl.callbacks import handle_etl_task_completion
from src.etl.tasks.repository import ETLTaskRepositorySupabase
from src.s3.dependencies import get_s3_service
from src.supabase.tables.repository import TableRepository
from src.supabase.dependencies import get_supabase_client

async def main():
    # Initialize services
    supabase_client = get_supabase_client()
    task_repo = ETLTaskRepositorySupabase(supabase_client=supabase_client)
    s3_service = get_s3_service()
    table_repo = TableRepository(supabase_client=supabase_client)
    
    # Get task 18
    task = task_repo.get_task(18)
    if not task:
        print("Task 18 not found")
        return
    
    print(f"Task 18 status: {task.status}")
    print(f"Task 18 metadata: {task.metadata}")
    
    # Trigger callback
    success = await handle_etl_task_completion(
        task=task,
        s3_service=s3_service,
        table_repository=table_repo
    )
    
    if success:
        print("✅ Table 25 updated successfully!")
    else:
        print("❌ Failed to update table 25")

if __name__ == "__main__":
    asyncio.run(main())
