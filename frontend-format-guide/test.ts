interface Todo{id:number;text:string;done:boolean}
class TodoManager{private todos:Todo[]=[];private nextId=1
addTodo(text:string):void{this.todos.push({id:this.nextId++,text,done:false})}
toggleTodo(id:number):void{const todo=this.todos.find(t=>t.id===id);if(todo)todo.done=!todo.done}
getTodos():Todo[]{return this.todos}
getActiveTodos():Todo[]{return this.todos.filter(t=>!t.done)}}
const manager=new TodoManager();manager.addTodo("learn TypeScript");manager.addTodo("write code");console.log(manager.getTodos())
