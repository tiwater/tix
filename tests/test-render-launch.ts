import { launchCloudNode, deleteCloudNode } from '../packages/gateway/src/cloud-nodes.js';

async function testRenderLaunch() {
  const testName = 'Test Node Provisioning';
  console.log(`Launching test node: "${testName}"...`);
  
  try {
    const { node, nodeId } = await launchCloudNode({
      name: testName,
      tier: 'nano',
      region: 'oregon',
    });
    
    console.log(`[OK] Node created! ID: ${node.id}, Name: ${node.name}`);
    
    const key = process.env.RENDER_API_KEY;
    console.log(`Fetching env vars for service ${node.id}...`);
    const envs = await fetch(`https://api.render.com/v1/services/${node.id}/env-vars`, { 
      headers: { Authorization: `Bearer ${key}` } 
    }).then(r => r.json());
    
    const keys = envs.map((e: any) => e.envVar.key);
    console.log(`[OK] Render recorded these env vars:`, keys);
    
    if (
      keys.includes('GATEWAY_SECRET') &&
      keys.includes('SUPEN_NODE_ID') &&
      keys.includes('HTTP_API_KEY')
    ) {
      console.log(`✅ SUCCESS! envVars are correctly passed and saved on Render.`);
    } else {
      console.log(`❌ FAILED! envVars are still missing! Received:`, keys);
    }
    
    console.log(`Cleaning up service ${node.id}...`);
    await deleteCloudNode(node.id);
    console.log(`[OK] Cleaned up test service.`);
    
  } catch (err: any) {
    console.error(`❌ ERROR:`, err.message);
  }
}

testRenderLaunch();
