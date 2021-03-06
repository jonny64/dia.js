const Dia = require ('../Dia.js')

module.exports = class {

    constructor (backend) {
        this.backend = backend
    }
    
    query (def) {
        return new Dia.DB.Query (this.model, def)
    }

    async select_vocabulary (t, o = {}) {

        let def = this.model.tables [t]

        let data = def.data; if (data && !Object.keys (o).length) return data

        if (!o.order) o.order = 2
        
        if ((o.label = o.label || 'label') != 'label') o.label = o.label.replace (/ AS.*/, '') + ' AS label'
        
        return this.select_all (`SELECT ${def.pk} id, ${o.label} FROM ${t} WHERE ${o.filter || '1=1'} ORDER BY ${o.order}`)

    }

    async add_vocabularies (data, def) {

        for (let name in def) {            
            let o = def [name] || {}            
            if (!o.off) data [name] = await this.select_vocabulary (o.name || name, o)        
        }

        return data

    }
    
    to_counting_sql (original_sql) {
        
        let [unordered_sql, order] = original_sql.split (/ORDER\s+BY/)
        
        if (!order) throw 'to_counting_sql received some sql without ORDER BY: ' + original_sql
            
        return 'SELECT COUNT(*) ' + unordered_sql.substr (unordered_sql.indexOf ('FROM'))
    
    }

    async select_all_cnt (original_sql, original_params, limit, offset = 0) {
    
        let [limited_sql, limited_params] = this.to_limited_sql_params (original_sql, original_params, limit, offset)

        return Promise.all ([
            this.select_all (limited_sql, limited_params),
            this.select_scalar (this.to_counting_sql (original_sql), original_params),
        ])
    
    }
    
    async select_scalar (sql, params = []) {
        let r = await this.select_hash (sql, params)
        for (let k in r) return r [k]
        return null
    }

    async add_all_cnt (data, def, limit, offset) {

        let q = this.query (def)        

        if (limit == undefined) limit = q.limit
        if (limit == undefined) throw 'LIMIT not set for add_all_cnt: ' + JSON.stringify (def)

        if (offset == undefined) offset = q.offset
        if (offset == undefined) offset = 0

        let [all, cnt] = await this.select_all_cnt (q.sql, q.params, limit, offset)

        data [q.parts [0].alias] = all
        data.cnt = cnt
        data.portion = limit
// TODO: avoid hardcoded names
        return data

    }

    async add (data, def) {
        let q = this.query (def)
        if (q.limit) throw 'LIMIT set, use add_all_cnt: ' + JSON.stringify (def)
        data [q.parts [0].alias] = await this.select_all (q.sql, q.params)
        return data
    }    
    
    async list (def) {
        let q = this.query (def)
        return await this.select_all (q.sql, q.params)
    }

    async fold (def, callback, data) {
        let q = this.query (def)
        await this.select_loop (q.sql, q.params, callback, data)
        return data
    }

    async select_loop (sql, params, cb, data) {
    
    	let rs = await this.select_stream (sql, params)
        	
    	return new Promise ((ok, fail) => {rs
	    	.on ('error', x  => fail (x))
	    	.on ('end',   () => ok (data))
	    	.on ('data',  r  => cb (r, data))
    	})
    
    }
    
    async insert_if_absent (table, data) {
    
        try {
            await this.db.insert (table, data)
        }
        catch (x) {
            if (this.db.is_pk_violation (x)) return data
            throw x
        }    

    }
    
    async update (table, data, key) {

        let def = this.model.tables [table]
        if (!def) throw 'Table not found: ' + table

        if (Array.isArray (data)) {
            for (let d of data) await this.update (table, d, key)
            return
        }
        
        if (key == null) key = def.p_k
        if (!Array.isArray (key)) throw 'The key must be an array of field names, got ' + JSON.stringify (key)
        if (!key.length) throw 'Empty update key supplied for ' + table

        let [fields, filter, params] = [[], [], []]
        
        for (let k of key) {
            let v = data [k]
            if (v == undefined) throw 'No ' + k + ' supplied for ' + table + ': ' + JSON.stringify (data)
            filter.push (`${k}=?`)
            params.push (v)
            delete data [k]
        }

        for (let k in data) {
            let v = data [k]
            if (!(k in def.columns) || typeof v === 'undefined') continue
            fields.unshift (`${k}=?`)
            params.unshift (v)
        }
        
        if (!fields.length) return new Promise ((ok, fail) => ok (darn ('Nothig to update in ' + table + ', only key fields supplied: '  + JSON.stringify ([filter, params]))))

        return this.do (`UPDATE ${table} SET ${fields} WHERE ${filter.join (' AND ')}`, params)

    }

    async delete (table, data) {
    
		let {sql, params} = this.query ({[table]: data})
		
		if (params.length == 0) throw 'DELETE without a filter? If sure, use this.db.do directly.'
		
		sql = 'DELETE ' + sql.slice (sql.indexOf ('FROM'))
		
		return this.do (sql, params)
		
    }    
    
    async delepsert (table, data, items, key) {

    	let todo = []

    	let del = clone (data)

    	if (items.length > 0) {

	        let def = this.model.tables [table]
	        
	        if (!key) {
	        
	        	let fields = def.p_k.filter (k => !(k in data))

	        	if (fields.length != 1) throw `Can't guess the distinction key for ${table} ${JSON.stringify (data)}`
	        	
	        	key = fields [0]
	        	
	        }

			del [key + ' NOT IN'] = items.map (i => i [key])

	        let u_k = [key]; for (let k in data) u_k.push (k)

	        todo.push (this.upsert (table, items.map (i => Object.assign ({}, i, data)), u_k))

    	}

    	todo.push (this.delete (table, del))

    	return Promise.all (todo)

    }

    async load_schema () {
    
        await this.load_schema_tables ()
        await this.load_schema_table_columns ()
        await this.load_schema_table_keys ()
        await this.load_schema_table_triggers ()
        await this.load_schema_table_data ()

    }

    async load_schema_table_data () {

    	for (let table of Object.values (this.model.tables)) {

    		let {data} = table

    		if (!data || !data.length) continue

    		let idx = {}, f = {}, pk = table.pk; for (let r of Object.values (table.data)) {

    			for (let k in r) if (!(k in f)) f [k] = 1
    		
    			idx ['' + r [pk]] = clone (r)
    			
    		}
    		
    		let {existing} = table; if (existing) {
    		
    			let cols = Object.keys (f).filter (n => existing.columns [n]); if (cols.length) {

					let ids = Object.keys (idx); await this.select_loop (`SELECT ${cols} FROM ${table.name} WHERE ${pk} IN (${ids.map (i => '?')})`, ids, r => {

						let id = r [pk]

						let d = idx [id]; if (!d) return

						for (let k in d) if ('' + d [k] != '' + r [k]) return

						delete idx [id]

					})

    			}    			
    			
    		}
    		
			table._data_modified = Object.values (idx)

    	}

    }    

}