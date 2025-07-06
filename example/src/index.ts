import { NfsServer } from "tspace-nfs";
import fsSystem from 'fs'
import pathSystem from 'path'

const ROOT_DIR = 'nfs'

const getBuckets = () => {
  const nfsPath = pathSystem.join(pathSystem.resolve(), ROOT_DIR);

  try {
    if (!fsSystem.existsSync(nfsPath)) {
      fsSystem.mkdirSync(nfsPath, { recursive: true });
    }

    let buckets = fsSystem.readdirSync(nfsPath).filter((name) => {
      return fsSystem.statSync(pathSystem.join(nfsPath, name)).isDirectory();
    });

    if (buckets.length === 0) {
      for (let i = 1; i <= 6; i++) {
        const folder = pathSystem.join(nfsPath, `folder-${i}`);
        fsSystem.mkdirSync(folder, { recursive: true });
      }

      buckets = fsSystem.readdirSync(nfsPath).filter((name) => {
        return fsSystem.statSync(pathSystem.join(nfsPath, name)).isDirectory();
      });
    }

    return buckets;
  } catch (err) {
    return [];
  }
};

const requests: {
  bucket: string;
  time: string; 
  path: string;   
  file: string; 
  ip?: string | null;
  userAgent?: string | null;
}[] = [];

const monitors : {
  host ?: string | null
  cid ?: string | null
  time ?: string | null
  ram: { total: number, used: number },
  cpu: { total: number, used: number }
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

      const mergerRequest: {
        date: string;
        bucket: string;
        count: number;
      }[] = [];

      const map = new Map<string, { date: string; bucket: string; count: number }>();

      for (const req of requests) {
        const date = new Date(req.time).toLocaleDateString('sv-SE');
        const key = `${date}-${req.bucket}`;
        if (!map.has(key)) {
          map.set(key, { date, bucket: req.bucket, count: 1 });
        } else {
          map.get(key)!.count++;
        }
      }

      mergerRequest.push(...map.values());

      return mergerRequest
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
  return await new Promise(r => setTimeout(() => r(getBuckets())));
})
.onMonitors(async (v) => {
  monitors.push(v)
},1000 * 10)
.onRequestLogs(async (c) => {
  requests.push(...c)
},1000 * 10)
.credentials({
  expired : 1000 * 3600,
  secret : 'hi!'
})
.onCredentials(async ({ token , secret , bucket }) => {
  const lists = [
    {
      token: 'token-folder-1',
      secret: 'secret-folder-1',
      bucket : 'folder-1'
    }
  ]
  return lists.every(list => list.bucket === bucket && list.secret === secret && list.token === token)
})
.debug()
.progress()
.directory(ROOT_DIR)
// .listen(8000 , ({ port }) => {
//   console.log(`Server is running at http://localhost:${port}/`);
// })
// write this to support deploy in k8s
.listen(8000 , 'localhost' , ({ port }) => {
  console.log(`Server is running at http://localhost:${port}/`);
})