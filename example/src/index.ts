import { NfsServer } from "tspace-nfs";
import fsSystem from 'fs'
import pathSystem from 'path'

const buckets = fsSystem.readdirSync(pathSystem.join(pathSystem.resolve(),'nfs')).filter((name) => {
    return fsSystem.statSync(pathSystem.join('nfs', name)).isDirectory();
}) 

function generateRequests(rows = 50) {
  const buckets = ["dev1", "dev2", "dev3", "dev4", "dev5", "dev6"];
  const days = 7;
  const result: {
    date: string;
    bucket:string;
    count:number;
  }[] = [];
  const today = new Date();

  function formatDate(date : Date) {
    return date.toISOString().slice(0, 10);
  }

  for (let i = 0; i < rows; i++) {
    const dayOffset = Math.floor(Math.random() * days);
    const date = new Date(today);
    date.setDate(today.getDate() - dayOffset);
    const dateStr = formatDate(date);

    const bucket = buckets[Math.floor(Math.random() * buckets.length)];

    const count = Math.floor(Math.random() * 50) + 1;

    result.push({
      date: dateStr,
      bucket,
      count,
    });
  }

  return result;
}

const requests: {
  date: string;
  bucket: string;
  count: number
}[] = [];


const MAX_TOTAL_RAM = 16000
function generateMockMonitors(count: number): {
  host: string,
  ram: { total: number, used: number, unit: string, time: string },
  cpu: { total: number, used: number, unit: string, time: string }
}[] {
  const monitors : any[] = []
  const now = new Date()

  for (let i = 1; i <= count; i++) {
    const host = `vm-${((i - 1) % 3) + 1}`
    const time = new Date(now.getTime() + i * 60000).toISOString() // +1 min per entry

    monitors.push({
      host,
      cid: (Math.random() * 9999999999).toString(36),
      ram: {
        total: MAX_TOTAL_RAM,
        used: parseFloat((Math.random() * MAX_TOTAL_RAM).toFixed(4)),
        time
      },
      cpu: {
        total: 8,
        used: parseFloat((Math.random() * 100).toFixed(4)),
        time
      }
    })
  }

  return monitors
}

const monitors : {
  host ?: string | null,
  cid ?: string | null,
  ram: { total: number, used: number, time: string },
  cpu: { total: number, used: number, time: string }
}[] = []


new NfsServer()
.useStudio({
    onCredentials : async ({ username , password }) => {

        const credentials = [
            {
                buckets : ['*'],
                username: 'root',
                password: '',
            }
        ]
    
        const find = credentials.find(v => v.username === username && v.password === password )
    
        const result = {
            logged : find == null ? false : true,
            buckets : find == null ? [] : find?.buckets
        }
    
        return result
    },
    onBucketCreated : async ({ token , secret , bucket }) => {

        console.log({
            token , secret , bucket
        })
    
        return
    },
    onLoadBucketCredentials  : async () => {

        const credentials = [
            {
                token : 't', 
                secret : 's', 
                bucket : 'dev'
            },
            {
                token : 't1', 
                secret : 's1', 
                bucket : 'dev1'
            },
            {
                token : 't2', 
                secret : 's2', 
                bucket : 'dev2'
            }
        ]

        return credentials 
    },
    onLoadRequests : async () => {
      return requests
    },
    onLoadMonitors : async () => {

        const merged = monitors.reduce((acc, cur) => {
          const found = acc.find(m => m.host === cur.host);
          if (found) {
              found.rams.push(cur.ram);
              found.cpus.push(cur.cpu);
          } else {
              acc.push({
              host: cur.host,
              cid: cur.cid,
              rams: [cur.ram],
              cpus: [cur.cpu]
              });
          }
          return acc;
        }, [] as any[]);

        return await new Promise(r => setTimeout(() => r(merged)));
    }
})
.onLoadBucketLists(async () => {
    return await new Promise(r => setTimeout(() => r(buckets)));
})
.onMonitors(async (v) => {
    console.log(v)
    monitors.push(...generateMockMonitors(10))
},1000 * 10)
.onRequestLogs(async (c) => {
    console.log(c)
    requests.push(...generateRequests(10))
},1000 * 10)
.credentials({
  expired : 1000 * 3600,
  secret : 'hi!'
})
.onCredentials(async ({ token , secret , bucket }) => {
  const lists = [
      {
          token: 'token-dev',
          secret: 'secret-dev',
          bucket : 'dev'
      }
  ]
  return lists.every(list => list.bucket === bucket && list.secret === secret && list.token === token)
})
.debug()
.progress()
.directory('nfs')
.listen(7000 , ({ port }) => console.log(`Server is running on port http://localhost:${port}/studio`))