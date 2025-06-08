class Queue {
    private queue: Function[]
    private concurrency: number
    private activeJobs: number

    constructor(concurrency = 1) {
        this.queue = []
        this.concurrency = concurrency
        this.activeJobs = 0
    }

    add(job : Function) {
        this.queue.push(job)
        this._processQueue()
    }

    private async _next() {
        this.activeJobs -= 1
        await this._processQueue(); 
    }

    private async _processQueue() {
        
        if (this.activeJobs >= this.concurrency || this.queue.length === 0) {
            return;
        }

        const job = this.queue.shift()

        if(job == null) {
            return await this._next()
        }

        this.activeJobs += 1
        
        try {
            
            await job()

            return await this._next()

        } catch (error) {

            return await this._next()
        }
    }
}

export { Queue }
export default Queue