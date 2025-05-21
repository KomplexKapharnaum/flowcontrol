require('dotenv').config();
const { Server } = require('node-osc');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// .env configuration
const OSC_PORTIN = process.env.OSC_PORTIN || 9000;
const OSC_PORTOUT = process.env.OSC_PORTOUT || 9001;
const COMFYUI_SERVER = process.env.COMFYUI_SERVER || '127.0.0.1:8188';
const WORKFLOW_PATH = path.resolve( process.env.WORKFLOW_PATH || './workflows' )

const PROMPT_URL = `http://${COMFYUI_SERVER}/prompt`;
const QUEUE_URL = `http://${COMFYUI_SERVER}/queue`;

const CLIENT_ID = Math.random().toString(36).substr(2, 9);

var looping = false;
var loopPromise = null;
var startTime = null;

// Recursive function to replace "$RANDOM$" string with random number
function replaceRandomNumbers(obj) {
  if (typeof obj === 'string') {
    return obj.replace(/\$RANDOM/g, Math.floor(Math.random() * 10000000));
  } else if (Array.isArray(obj)) {
    return obj.map(replaceRandomNumbers);
  } else if (typeof obj === 'object' && obj !== null) {
    for (const key in obj) {
      obj[key] = replaceRandomNumbers(obj[key]);
    }
    return obj;
  }
  return obj;
}

// OSC server setup
const oscServer = new Server(OSC_PORTIN, '0.0.0.0', () => {
  console.log(`OSC Server is listening on port ${OSC_PORTIN}`);
});

oscServer.on('message', async (msg) => {
  console.log('OSC Message:', msg);

  if (msg[0] === '/play') {
    await stopWorkflowLoop();
    loopPromise = runWorkflowLoop(msg[1]);
  }

  if (msg[0] === '/stop') 
    await stopWorkflowLoop();

});

async function stopWorkflowLoop() {
  looping = false;
  if (loopPromise) {
    console.log('Stopping workflow loop...');
    await loopPromise
    console.log('Workflow loop stopped.');
  }
}

async function runWorkflowLoop(workflowFile) {
  const workflowFilePath = path.join(WORKFLOW_PATH, workflowFile+'.json');
  if (!fs.existsSync(workflowFilePath)) {
    console.error(`Workflow file not found: ${workflowFilePath}`);
    looping = false;
    loopPromise = null;
    return;
  }

  const workflow = JSON.parse(fs.readFileSync(workflowFilePath, 'utf8'));
  looping = true;

  while (looping) {
    try {
      startTime = Date.now();
      console.log('----\nRunning workflow:', workflowFile);

      // copy original workflow to avoid modifying the original
      const modifiedWorkflow = JSON.parse(JSON.stringify(workflow))

      // Replace $RANDOM in the workflow
      replaceRandomNumbers(modifiedWorkflow);

      const payload = { prompt: modifiedWorkflow, client_id: CLIENT_ID };
      await axios.post(PROMPT_URL, payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      // Wait for completion - adjust as needed (polling, or fixed delay)
      await waitForComfyPending();

      console.log('Execution time:', (Date.now() - startTime) / 1000, 'seconds');
      // console.log('Workflow completed:', workflowFile, '\n----')
    } catch (err) {
      console.error('Workflow error:', err);
      break;
    }
  }

  await waitForComfyAll();
  loopPromise = null;
}

// Wait for pending jobs to finish 
async function waitForComfyPending(pollInterval = 200) {
  while (true) {
    try {
      const res = await axios.get(QUEUE_URL);
      const pending = res.data.queue_pending || [];
      const mePending = pending.filter(job => job[3].client_id === CLIENT_ID);

      // No more jobs pending: we can stack up the next one
      if (mePending.length === 0) break;

    } catch (err) {
      console.error('Error polling ComfyUI queue:', err.message);
    }
    await new Promise(res => setTimeout(res, pollInterval));
  }
}

// Wait for all jobs to finish
async function waitForComfyAll(pollInterval = 200) {
  while (true) {
    try {
      const res = await axios.get(QUEUE_URL);
      const running = res.data.queue_running || [];
      const pending = res.data.queue_pending || [];

      const meRunning = running.filter(job => job[3].client_id === CLIENT_ID);
      const mePending = pending.filter(job => job[3].client_id === CLIENT_ID);

      // No more jobs pending or running
      if (meRunning.length === 0 && mePending.length === 0) break;

    } catch (err) {
      console.error('Error polling ComfyUI queue:', err.message);
    }
    await new Promise(res => setTimeout(res, pollInterval));
  }
}