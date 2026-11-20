// Aplica mergeTasks (src/aiTasks.ts, el de la app) a lo que manda dos_pasos.py por stdin.
import { mergeTasks } from "../../src/aiTasks.ts";
const input = JSON.parse(await new Response(process.stdin as unknown as ReadableStream).text());
process.stdout.write(mergeTasks(input.md, input.data, input.hours, input.text));
