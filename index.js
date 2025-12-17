// =============================
// Ultimate Minecraft Guard & Utility Bot Pro
// Version: 3.0.0 | Features: 50+ | Lines: 1200+
// =============================

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalFollow, GoalNear, GoalBlock, GoalXZ, GoalY } = goals
const Vec3 = require('vec3')
const fs = require('fs').promises
const path = require('path')

// =============================
// CONFIGURATION
// =============================
const config = {
    host: 'localhost',
    port: 25565,
    username: 'GuardBot',
    version: '1.20.1',
    prefix: '!',
    autoReconnect: true,
    autoReconnectDelay: 5000,
    chatDistance: 100,
    viewDistance: 256,
    defaultCPS: 8,
    autoEatThreshold: 14,
    saveInterval: 30000,
    logLevel: 'INFO'
}

// =============================
// BOT CLASS - MODULAR ARCHITECTURE
// =============================
class UltimateGuardBot {
    constructor() {
        this.bot = null
        this.state = {
            adoptedBy: null,
            isFollowing: false,
            guardMode: false,
            patrolMode: false,
            autoMining: false,
            autoFarming: false,
            autoFishing: false,
            autoBreeding: false,
            combatMode: 'defensive', // defensive, aggressive, passive
            cps: config.defaultCPS,
            awaitingConfirmation: null,
            homePosition: null,
            guardCenter: null,
            guardRadius: 8,
            patrolPoints: [],
            patrolIndex: 0,
            miningTargets: [],
            farmingArea: null,
            fishingSpot: null,
            lastAction: Date.now(),
            activityLog: []
        }
        
        this.lists = {
            whitelist: new Set(),
            blacklist: new Set(),
            trustedPlayers: new Set(),
            mobBlacklist: new Set(['bat', 'villager', 'cat', 'dog', 'horse']),
            hostileMobs: new Set(['zombie', 'skeleton', 'spider', 'creeper', 'enderman'])
        }
        
        this.timers = {
            followInterval: null,
            attackInterval: null,
            miningInterval: null,
            farmingInterval: null,
            fishingInterval: null,
            breedInterval: null,
            saveInterval: null,
            antiAfkInterval: null,
            activityMonitor: null
        }
        
        this.stats = {
            mobsKilled: 0,
            playersKilled: 0,
            blocksMined: 0,
            itemsCollected: 0,
            cropsHarvested: 0,
            fishCaught: 0,
            animalsBred: 0,
            distanceTraveled: 0,
            damageDealt: 0,
            damageTaken: 0
        }
        
        this.inventoryConfig = {
            autoSort: true,
            keepItems: ['diamond', 'emerald', 'iron_ingot', 'gold_ingot', 'ender_pearl'],
            trashItems: ['rotten_flesh', 'poisonous_potato', 'wheat_seeds'],
            autoRefill: true,
            refillThreshold: 32
        }
        
        this.init()
    }

    // =============================
    // INITIALIZATION
    // =============================
    async init() {
        await this.loadData()
        this.createBot()
        this.setupEventHandlers()
        this.setupTimers()
    }

    createBot() {
        this.bot = mineflayer.createBot({
            host: config.host,
            port: config.port,
            username: config.username,
            version: config.version,
            viewDistance: config.viewDistance,
            chatLengthLimit: 256,
            physics: {
                canFly: true,
                gravity: 0.08
            }
        })

        this.bot.loadPlugin(pathfinder)
        this.log('Bot created successfully', 'INFO')
    }

    // =============================
    // DATA PERSISTENCE
    // =============================
    async loadData() {
        try {
            const dataPath = path.join(__dirname, 'bot_data.json')
            if (await fs.access(dataPath).then(() => true).catch(() => false)) {
                const data = JSON.parse(await fs.readFile(dataPath, 'utf8'))
                
                this.state.adoptedBy = data.adoptedBy
                this.state.homePosition = data.homePosition
                this.state.guardCenter = data.guardCenter
                this.state.guardRadius = data.guardRadius || 8
                this.state.patrolPoints = data.patrolPoints || []
                this.lists.whitelist = new Set(data.whitelist || [])
                this.lists.blacklist = new Set(data.blacklist || [])
                this.stats = { ...this.stats, ...data.stats }
                
                this.log('Data loaded successfully', 'INFO')
            }
        } catch (error) {
            this.log(`Failed to load data: ${error.message}`, 'ERROR')
        }
    }

    async saveData() {
        try {
            const data = {
                adoptedBy: this.state.adoptedBy,
                homePosition: this.state.homePosition,
                guardCenter: this.state.guardCenter,
                guardRadius: this.state.guardRadius,
                patrolPoints: this.state.patrolPoints,
                whitelist: Array.from(this.lists.whitelist),
                blacklist: Array.from(this.lists.blacklist),
                stats: this.stats,
                lastSave: Date.now()
            }

            const dataPath = path.join(__dirname, 'bot_data.json')
            await fs.writeFile(dataPath, JSON.stringify(data, null, 2))
            this.log('Data saved successfully', 'INFO')
        } catch (error) {
            this.log(`Failed to save data: ${error.message}`, 'ERROR')
        }
    }

    // =============================
    // EVENT HANDLERS
    // =============================
    setupEventHandlers() {
        this.bot.once('spawn', () => this.onSpawn())
        this.bot.on('chat', (username, message) => this.onChat(username, message))
        this.bot.on('whisper', (username, message) => this.onWhisper(username, message))
        this.bot.on('entityHurt', (entity) => this.onEntityHurt(entity))
        this.bot.on('entitySpawn', (entity) => this.onEntitySpawn(entity))
        this.bot.on('playerCollect', (collector, collected) => this.onPlayerCollect(collector, collected))
        this.bot.on('death', () => this.onDeath())
        this.bot.on('health', () => this.onHealthUpdate())
        this.bot.on('breath', () => this.onBreathUpdate())
        this.bot.on('spawnReset', () => this.onSpawnReset())
        this.bot.on('rain', () => this.onWeatherChange())
        this.bot.on('time', () => this.onTimeUpdate())
        this.bot.on('kicked', (reason) => this.onKicked(reason))
        this.bot.on('error', (error) => this.onError(error))
        this.bot.on('end', (reason) => this.onEnd(reason))
        
        // Physics tick for continuous monitoring
        this.bot.on('physicsTick', () => this.onPhysicsTick())
    }

    // =============================
    // CORE EVENT IMPLEMENTATIONS
    // =============================
    onSpawn() {
        this.log('Bot spawned in world', 'INFO')
        this.setupMovements()
        this.equipBestGear()
        this.autoEatIfNeeded()
        
        if (this.state.homePosition) {
            this.bot.chat('I have returned to the world! Home position saved.')
        }
    }

    onChat(username, message) {
        if (username === this.bot.username) return
        
        // Handle commands
        if (message.startsWith(config.prefix)) {
            this.handleCommand(username, message)
            return
        }
        
        // Handle mentions
        if (message.toLowerCase().includes(this.bot.username.toLowerCase())) {
            if (this.state.adoptedBy === username || this.lists.whitelist.has(username)) {
                this.sendMessage(username, `You called, ${username}?`)
            }
        }
        
        // Log activity
        this.logActivity(`Chat from ${username}: ${message}`)
    }

    onEntityHurt(entity) {
        if (!entity) return
        
        if (entity.type === 'player' && entity.username === this.state.adoptedBy) {
            const attacker = entity.attacker
            if (attacker) {
                this.log(`Owner ${this.state.adoptedBy} was attacked by ${attacker.name || attacker.type}`, 'WARN')
                
                if (this.state.combatMode === 'defensive' || this.state.combatMode === 'aggressive') {
                    this.attackEntity(attacker)
                }
            }
        }
        
        if (entity === this.bot.entity) {
            this.stats.damageTaken++
            this.autoEatIfNeeded()
            this.retaliateIfAttacked(entity.attacker)
        }
    }

    onEntitySpawn(entity) {
        if (!entity) return
        
        // Auto-attack hostile mobs in aggressive mode
        if (this.state.combatMode === 'aggressive' && 
            entity.type === 'mob' && 
            this.lists.hostileMobs.has(entity.name)) {
            
            if (entity.position.distanceTo(this.bot.entity.position) < 16) {
                setTimeout(() => this.attackEntity(entity), 1000)
            }
        }
    }

    // =============================
    // MOVEMENT & PATHFINDING
    // =============================
    setupMovements() {
        const movements = new Movements(this.bot)
        movements.canDig = true
        movements.canPlace = true
        movements.allow1by1towers = true
        movements.allowFreeMotion = true
        movements.allowParkour = true
        movements.maxDropDown = 4
        
        this.bot.pathfinder.setMovements(movements)
    }

    async moveToPosition(pos, range = 1) {
        try {
            const goal = new GoalNear(pos.x, pos.y, pos.z, range)
            await this.bot.pathfinder.goto(goal)
            return true
        } catch (error) {
            this.log(`Failed to move to position: ${error.message}`, 'ERROR')
            return false
        }
    }

    async followPlayer(username, distance = 2) {
        const player = this.bot.players[username]
        if (!player || !player.entity) {
            this.sendMessage(username, "I can't see you!")
            return false
        }

        try {
            const goal = new GoalFollow(player.entity, distance)
            this.bot.pathfinder.setGoal(goal, true)
            this.state.isFollowing = true
            return true
        } catch (error) {
            this.log(`Failed to follow player: ${error.message}`, 'ERROR')
            return false
        }
    }

    stopMovement() {
        this.bot.pathfinder.setGoal(null)
        this.state.isFollowing = false
        this.state.patrolMode = false
        this.state.autoMining = false
        this.state.autoFarming = false
    }

    // =============================
    // COMBAT SYSTEM
    // =============================
    attackEntity(entity) {
        if (!entity || !entity.isValid) return
        
        // Don't attack whitelisted players
        if (entity.type === 'player' && 
            (this.lists.whitelist.has(entity.username) || 
             entity.username === this.state.adoptedBy)) {
            return
        }
        
        // Don't attack blacklisted mobs
        if (entity.type === 'mob' && this.lists.mobBlacklist.has(entity.name)) {
            return
        }

        this.equipBestWeapon()
        
        try {
            this.bot.attack(entity)
            this.stats.damageDealt += 1
            
            if (!entity.isAlive || entity.health <= 0) {
                if (entity.type === 'mob') this.stats.mobsKilled++
                if (entity.type === 'player') this.stats.playersKilled++
            }
        } catch (error) {
            this.log(`Attack failed: ${error.message}`, 'ERROR')
        }
    }

    startAutoCombat(range = 16) {
        this.stopAutoCombat()
        
        this.timers.attackInterval = setInterval(() => {
            const target = this.findCombatTarget(range)
            if (target) {
                this.attackEntity(target)
            }
        }, 1000 / this.state.cps)
    }

    stopAutoCombat() {
        if (this.timers.attackInterval) {
            clearInterval(this.timers.attackInterval)
            this.timers.attackInterval = null
        }
    }

    findCombatTarget(range = 16) {
        const entities = Object.values(this.bot.entities)
            .filter(e => e.isValid && 
                   e.position.distanceTo(this.bot.entity.position) < range &&
                   e !== this.bot.entity)
        
        // Priority: Attacking owner > Hostile mobs > Players not in whitelist > Other mobs
        const owner = this.bot.players[this.state.adoptedBy]?.entity
        if (owner && owner.attacker) {
            return owner.attacker
        }
        
        const hostileMobs = entities.filter(e => 
            e.type === 'mob' && this.lists.hostileMobs.has(e.name))
        if (hostileMobs.length > 0) {
            return hostileMobs[0]
        }
        
        const enemyPlayers = entities.filter(e => 
            e.type === 'player' && 
            !this.lists.whitelist.has(e.username) && 
            e.username !== this.state.adoptedBy)
        if (enemyPlayers.length > 0) {
            return enemyPlayers[0]
        }
        
        return null
    }

    // =============================
    // INVENTORY MANAGEMENT
    // =============================
    equipBestWeapon() {
        const weapons = this.bot.inventory.items()
            .filter(item => item.name.includes('sword') || 
                           item.name.includes('axe'))
            .sort((a, b) => {
                const damageOrder = ['netherite', 'diamond', 'iron', 'gold', 'stone', 'wooden']
                const aIndex = damageOrder.findIndex(mat => a.name.includes(mat))
                const bIndex = damageOrder.findIndex(mat => b.name.includes(mat))
                return aIndex - bIndex
            })
        
        if (weapons.length > 0) {
            this.bot.equip(weapons[0], 'hand').catch(() => {})
        }
    }

    equipBestArmor() {
        const armorSlots = [
            { slot: 'head', types: ['helmet'] },
            { slot: 'torso', types: ['chestplate'] },
            { slot: 'legs', types: ['leggings'] },
            { slot: 'feet', types: ['boots'] }
        ]
        
        armorSlots.forEach(({ slot, types }) => {
            const armor = this.bot.inventory.items()
                .filter(item => types.some(type => item.name.includes(type)))
                .sort((a, b) => {
                    const materialOrder = ['netherite', 'diamond', 'iron', 'gold', 'chainmail', 'leather']
                    const aIndex = materialOrder.findIndex(mat => a.name.includes(mat))
                    const bIndex = materialOrder.findIndex(mat => b.name.includes(mat))
                    return aIndex - bIndex
                })
            
            if (armor.length > 0) {
                this.bot.equip(armor[0], slot).catch(() => {})
            }
        })
    }

    autoSortInventory() {
        if (!this.inventoryConfig.autoSort) return
        
        const items = this.bot.inventory.items()
        const chest = this.findNearbyChest(5)
        
        if (chest) {
            items.forEach(item => {
                if (this.inventoryConfig.trashItems.includes(item.name)) {
                    this.bot.tossStack(item).catch(() => {})
                } else if (!this.inventoryConfig.keepItems.includes(item.name) && 
                          item.count > this.inventoryConfig.refillThreshold) {
                    this.depositToChest(chest, item, item.count - this.inventoryConfig.refillThreshold)
                }
            })
        }
    }

    // =============================
    // MINING SYSTEM
    // =============================
    async startAutoMining(blockTypes = ['diamond_ore', 'iron_ore', 'coal_ore', 'gold_ore']) {
        this.state.autoMining = true
        
        this.timers.miningInterval = setInterval(async () => {
            const block = this.findNearbyBlock(blockTypes, 10)
            if (block) {
                await this.mineBlock(block)
                this.stats.blocksMined++
                
                // Look for more blocks of same type in vein
                const adjacent = this.findAdjacentBlocks(block.position, block.name, 3)
                for (const adjBlock of adjacent) {
                    await this.mineBlock(adjBlock)
                    this.stats.blocksMined++
                }
            }
        }, 2000)
    }

    async mineBlock(block) {
        try {
            await this.bot.dig(block)
            this.log(`Mined ${block.name}`, 'INFO')
        } catch (error) {
            this.log(`Failed to mine block: ${error.message}`, 'ERROR')
        }
    }

    // =============================
    // FARMING SYSTEM
    // =============================
    async startAutoFarming(area, cropTypes = ['wheat', 'carrots', 'potatoes', 'beetroots']) {
        this.state.farmingArea = area
        this.state.autoFarming = true
        
        this.timers.farmingInterval = setInterval(async () => {
            const crops = this.findMatureCrops(area, cropTypes)
            for (const crop of crops) {
                await this.harvestCrop(crop)
                await this.plantCrop(crop.position)
                this.stats.cropsHarvested++
            }
        }, 5000)
    }

    async harvestCrop(block) {
        try {
            await this.bot.dig(block)
            this.log(`Harvested ${block.name}`, 'INFO')
        } catch (error) {
            this.log(`Failed to harvest crop: ${error.message}`, 'ERROR')
        }
    }

    async plantCrop(position) {
        const seeds = this.bot.inventory.items().find(item => 
            item.name.includes('seeds') || 
            item.name.includes('potato') || 
            item.name.includes('carrot'))
        
        if (seeds) {
            try {
                await this.bot.equip(seeds, 'hand')
                await this.bot.placeBlock(this.bot.blockAt(position), new Vec3(0, 1, 0))
            } catch (error) {
                this.log(`Failed to plant crop: ${error.message}`, 'ERROR')
            }
        }
    }

    // =============================
    // FISHING SYSTEM
    // =============================
    async startAutoFishing() {
        this.state.autoFishing = true
        
        const waterBlock = this.findWaterBlock(5)
        if (!waterBlock) {
            this.log('No water found for fishing', 'WARN')
            return
        }
        
        this.state.fishingSpot = waterBlock.position
        await this.moveToPosition(waterBlock.position.offset(0, 1, 0))
        
        const fishingRod = this.bot.inventory.items().find(item => item.name === 'fishing_rod')
        if (!fishingRod) {
            this.log('No fishing rod found', 'WARN')
            return
        }
        
        await this.bot.equip(fishingRod, 'hand')
        
        this.timers.fishingInterval = setInterval(() => {
            const fishHook = Object.values(this.bot.entities)
                .find(e => e.name === 'fish_hook' && e.owner === this.bot.entity)
            
            if (fishHook) {
                this.bot.activateItem()
                this.stats.fishCaught++
            }
        }, 1000)
    }

    // =============================
    // BREEDING SYSTEM
    // =============================
    async startAutoBreeding(animalTypes = ['cow', 'pig', 'sheep', 'chicken'], foodItem) {
        this.state.autoBreeding = true
        
        this.timers.breedInterval = setInterval(async () => {
            const animals = this.findBreedableAnimals(animalTypes, 10)
            const food = this.bot.inventory.items().find(item => 
                item.name === foodItem || 
                (foodItem === 'wheat' && item.name.includes('wheat')) ||
                (foodItem === 'seeds' && item.name.includes('seeds')))
            
            if (animals.length >= 2 && food) {
                await this.bot.equip(food, 'hand')
                
                for (const animal of animals.slice(0, 2)) {
                    await this.bot.activateEntity(animal)
                }
                
                this.stats.animalsBred++
            }
        }, 10000)
    }

    // =============================
    // COMMAND HANDLER
    // =============================
    handleCommand(username, message) {
        const args = message.slice(config.prefix.length).trim().split(' ')
        const command = args.shift().toLowerCase()
        
        // Check permissions
        if (!this.hasPermission(username, command)) {
            this.sendMessage(username, "You don't have permission to use this command!")
            return
        }
        
        // Route to command handler
        switch (command) {
            case 'adopt':
                this.commandAdopt(username, args)
                break
            case 'unadopt':
                this.commandUnadopt(username, args)
                break
            case 'help':
                this.commandHelp(username, args)
                break
            case 'come':
            case 'follow':
                this.commandFollow(username, args)
                break
            case 'stay':
            case 'stop':
                this.commandStop(username, args)
                break
            case 'guard':
                this.commandGuard(username, args)
                break
            case 'unguard':
                this.commandUnguard(username, args)
                break
            case 'patrol':
                this.commandPatrol(username, args)
                break
            case 'home':
                this.commandHome(username, args)
                break
            case 'sethome':
                this.commandSetHome(username, args)
                break
            case 'mine':
                this.commandMine(username, args)
                break
            case 'farm':
                this.commandFarm(username, args)
                break
            case 'fish':
                this.commandFish(username, args)
                break
            case 'breed':
                this.commandBreed(username, args)
                break
            case 'attack':
                this.commandAttack(username, args)
                break
            case 'whitelist':
                this.commandWhitelist(username, args)
                break
            case 'blacklist':
                this.commandBlacklist(username, args)
                break
            case 'status':
                this.commandStatus(username, args)
                break
            case 'stats':
                this.commandStats(username, args)
                break
            case 'inventory':
                this.commandInventory(username, args)
                break
            case 'equip':
                this.commandEquip(username, args)
                break
            case 'drop':
                this.commandDrop(username, args)
                break
            case 'build':
                this.commandBuild(username, args)
                break
            case 'dig':
                this.commandDig(username, args)
                break
            case 'fill':
                this.commandFill(username, args)
                break
            case 'wall':
                this.commandWall(username, args)
                break
            case 'tower':
                this.commandTower(username, args)
                break
            case 'bridge':
                this.commandBridge(username, args)
                break
            case 'mode':
                this.commandMode(username, args)
                break
            case 'cps':
                this.commandCPS(username, args)
                break
            case 'radius':
                this.commandRadius(username, args)
                break
            case 'save':
                this.commandSave(username, args)
                break
            case 'load':
                this.commandLoad(username, args)
                break
            case 'log':
                this.commandLog(username, args)
                break
            case 'config':
                this.commandConfig(username, args)
                break
            case 'tp':
                this.commandTeleport(username, args)
                break
            case 'coords':
                this.commandCoords(username, args)
                break
            case 'look':
                this.commandLook(username, args)
                break
            case 'jump':
                this.commandJump(username, args)
                break
            case 'dance':
                this.commandDance(username, args)
                break
            case 'sit':
                this.commandSit(username, args)
                break
            case 'wave':
                this.commandWave(username, args)
                break
            case 'sleep':
                this.commandSleep(username, args)
                break
            case 'wake':
                this.commandWake(username, args)
                break
            default:
                this.sendMessage(username, `Unknown command: ${command}. Type !help for commands.`)
        }
    }

    // =============================
    // COMMAND IMPLEMENTATIONS
    // =============================
    commandAdopt(username, args) {
        if (this.state.adoptedBy) {
            this.sendMessage(username, `I'm already adopted by ${this.state.adoptedBy}`)
            return
        }
        
        this.state.adoptedBy = username
        this.lists.trustedPlayers.add(username)
        this.sendMessage(username, `You've adopted me! I'll protect you. Type !help for commands.`)
        this.log(`Adopted by ${username}`, 'INFO')
        this.saveData()
    }

    commandUnadopt(username, args) {
        if (!this.isOwner(username)) {
            this.sendMessage(username, "Only my owner can unadopt me!")
            return
        }
        
        if (args[0] === 'confirm') {
            this.state.adoptedBy = null
            this.stopAllActivities()
            this.sendMessage(username, "I've been released. Goodbye!")
            this.log(`Unadopted by ${username}`, 'INFO')
            this.saveData()
        } else {
            this.sendMessage(username, "Are you sure? Type !unadopt confirm to confirm.")
        }
    }

    commandHelp(username, args) {
        const helpCategories = {
            basic: ['!adopt', '!unadopt', '!help', '!status', '!stats'],
            movement: ['!come', '!follow', '!stay', '!stop', '!home', '!sethome', '!tp'],
            combat: ['!guard', '!unguard', '!attack', '!patrol', '!mode', '!cps'],
            management: ['!whitelist', '!blacklist', '!inventory', '!equip', '!drop'],
            automation: ['!mine', '!farm', '!fish', '!breed', '!build'],
            utility: ['!dig', '!fill', '!wall', '!tower', '!bridge'],
            fun: ['!dance', '!sit', '!wave', '!jump', '!look'],
            admin: ['!save', '!load', '!log', '!config', '!radius']
        }
        
        let helpMessage = "=== Ultimate Guard Bot Commands ===\n"
        for (const [category, commands] of Object.entries(helpCategories)) {
            helpMessage += `\n${category.toUpperCase()}:\n  ${commands.join(', ')}`
        }
        
        this.sendMessage(username, helpMessage)
    }

    commandGuard(username, args) {
        if (!this.isOwner(username)) return
        
        this.state.guardMode = true
        this.state.guardCenter = this.bot.entity.position.clone()
        this.state.guardRadius = parseInt(args[0]) || 8
        
        this.sendMessage(username, `Guard mode activated! Radius: ${this.state.guardRadius} blocks`)
        this.startAutoCombat(this.state.guardRadius)
    }

    commandPatrol(username, args) {
        if (!this.isOwner(username)) return
        
        if (args[0] === 'add') {
            this.state.patrolPoints.push(this.bot.entity.position.clone())
            this.sendMessage(username, `Patrol point added! Total: ${this.state.patrolPoints.length}`)
        } else if (args[0] === 'start' && this.state.patrolPoints.length > 0) {
            this.state.patrolMode = true
            this.patrolToNextPoint()
            this.sendMessage(username, "Patrol started!")
        } else if (args[0] === 'stop') {
            this.state.patrolMode = false
            this.sendMessage(username, "Patrol stopped!")
        } else if (args[0] === 'clear') {
            this.state.patrolPoints = []
            this.sendMessage(username, "Patrol points cleared!")
        }
    }

    async patrolToNextPoint() {
        if (!this.state.patrolMode || this.state.patrolPoints.length === 0) return
        
        const point = this.state.patrolPoints[this.state.patrolIndex]
        await this.moveToPosition(point, 2)
        
        // Wait at point
        await new Promise(resolve => setTimeout(resolve, 5000))
        
        // Move to next point
        this.state.patrolIndex = (this.state.patrolIndex + 1) % this.state.patrolPoints.length
        this.patrolToNextPoint()
    }

    async commandBuild(username, args) {
        if (!this.isOwner(username)) return
        
        const structure = args[0]
        const size = parseInt(args[1]) || 5
        
        switch (structure) {
            case 'house':
                await this.buildHouse(size)
                break
            case 'wall':
                await this.buildWall(size, parseInt(args[2]) || 3)
                break
            case 'tower':
                await this.buildTower(size)
                break
            case 'bridge':
                await this.buildBridge(size)
                break
            default:
                this.sendMessage(username, "Available structures: house, wall, tower, bridge")
        }
    }

    async buildHouse(size) {
        const startPos = this.bot.entity.position.floored()
        const blocks = this.bot.inventory.items().filter(item => 
            item.name.includes('planks') || item.name.includes('log') || item.name.includes('wood'))
        
        if (blocks.length === 0) {
            this.sendMessage(this.state.adoptedBy, "I don't have any building materials!")
            return
        }
        
        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                for (let y = 0; y < 4; y++) {
                    const pos = startPos.offset(x, y, z)
                    if (x === 0 || x === size - 1 || z === 0 || z === size - 1 || y === 3) {
                        await this.placeBlockAt(pos, blocks[0])
                    }
                }
            }
        }
        
        // Add door
        const doorPos = startPos.offset(Math.floor(size / 2), 1, 0)
        await this.placeBlockAt(doorPos, this.bot.inventory.items().find(item => item.name === 'oak_door'))
    }

    // =============================
    // UTILITY METHODS
    // =============================
    hasPermission(username, command) {
        const ownerOnlyCommands = ['unadopt', 'guard', 'unguard', 'mode', 'config', 'save', 'load']
        const trustedCommands = ['whitelist', 'blacklist', 'inventory', 'equip']
        
        if (ownerOnlyCommands.includes(command)) {
            return this.isOwner(username)
        }
        
        if (trustedCommands.includes(command)) {
            return this.isOwner(username) || this.lists.trustedPlayers.has(username)
        }
        
        return true
    }

    isOwner(username) {
        return this.state.adoptedBy === username
    }

    sendMessage(recipient, message) {
        if (recipient) {
            this.bot.chat(`/msg ${recipient} ${message}`)
        } else {
            this.bot.chat(message)
        }
    }

    log(message, level = 'INFO') {
        const timestamp = new Date().toISOString()
        const logMessage = `[${timestamp}] [${level}] ${message}`
        
        console.log(logMessage)
        this.state.activityLog.push(logMessage)
        
        // Keep log size manageable
        if (this.state.activityLog.length > 1000) {
            this.state.activityLog = this.state.activityLog.slice(-500)
        }
    }

    logActivity(activity) {
        this.state.activityLog.push(`[${new Date().toISOString()}] ${activity}`)
        this.state.lastAction = Date.now()
    }

    // =============================
    // TIMERS & AUTOMATION
    // =============================
    setupTimers() {
        // Auto-save
        this.timers.saveInterval = setInterval(() => this.saveData(), config.saveInterval)
        
        // Anti-AFK
        this.timers.antiAfkInterval = setInterval(() => this.antiAfk(), 60000)
        
        // Activity monitor
        this.timers.activityMonitor = setInterval(() => this.monitorActivity(), 10000)
        
        // Auto inventory management
        setInterval(() => this.autoSortInventory(), 30000)
        
        // Auto heal/eat
        setInterval(() => this.autoEatIfNeeded(), 5000)
    }

    antiAfk() {
        const actions = [
            () => this.bot.setControlState('jump', true),
            () => this.bot.setControlState('sneak', true),
            () => this.bot.look(Math.random() * Math.PI * 2, Math.random() * Math.PI - Math.PI / 2),
            () => this.bot.swingArm()
        ]
        
        const action = actions[Math.floor(Math.random() * actions.length)]
        action()
        
        setTimeout(() => {
            this.bot.setControlState('jump', false)
            this.bot.setControlState('sneak', false)
        }, 200)
    }

    monitorActivity() {
        const now = Date.now()
        const inactiveTime = now - this.state.lastAction
        
        if (inactiveTime > 300000 && this.state.adoptedBy) { // 5 minutes
            this.sendMessage(this.state.adoptedBy, "I've been inactive for 5 minutes. Everything okay?")
            this.state.lastAction = now
        }
    }

    autoEatIfNeeded() {
        if (this.bot.food < config.autoEatThreshold) {
            const food = this.bot.inventory.items().find(item => 
                item.name.includes('bread') ||
                item.name.includes('steak') ||
                item.name.includes('porkchop') ||
                item.name.includes('apple') ||
                item.name === 'cooked_beef' ||
                item.name === 'cooked_porkchop')
            
            if (food) {
                this.bot.equip(food, 'hand').then(() => {
                    this.bot.consume()
                    this.log(`Ate ${food.name}`, 'INFO')
                }).catch(() => {})
            }
        }
    }

    retaliateIfAttacked(attacker) {
        if (attacker && this.state.combatMode !== 'passive') {
            setTimeout(() => this.attackEntity(attacker), 500)
        }
    }

    // =============================
    // BLOCK FINDING UTILITIES
    // =============================
    findNearbyBlock(blockTypes, radius) {
        const botPos = this.bot.entity.position.floored()
        
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    const pos = botPos.offset(dx, dy, dz)
                    const block = this.bot.blockAt(pos)
                    
                    if (block && blockTypes.includes(block.name)) {
                        return block
                    }
                }
            }
        }
        
        return null
    }

    findWaterBlock(radius) {
        return this.findNearbyBlock(['water', 'flowing_water'], radius)
    }

    findBreedableAnimals(types, radius) {
        return Object.values(this.bot.entities)
            .filter(e => e.isValid && 
                   e.type === 'mob' && 
                   types.includes(e.name) &&
                   e.position.distanceTo(this.bot.entity.position) < radius &&
                   e.metadata[15] === 0) // Check if can breed
    }

    findMatureCrops(area, cropTypes) {
        const crops = []
        const [min, max] = area
        
        for (let x = min.x; x <= max.x; x++) {
            for (let z = min.z; z <= max.z; z++) {
                for (let y = min.y; y <= max.y; y++) {
                    const pos = new Vec3(x, y, z)
                    const block = this.bot.blockAt(pos)
                    
                    if (block && cropTypes.includes(block.name.replace('_block', ''))) {
                        // Check if crop is mature (metadata 7 for most crops)
                        if (block.metadata === 7) {
                            crops.push(block)
                        }
                    }
                }
            }
        }
        
        return crops
    }

    findAdjacentBlocks(position, blockType, radius) {
        const blocks = []
        const center = position.floored()
        
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue
                    
                    const pos = center.offset(dx, dy, dz)
                    const block = this.bot.blockAt(pos)
                    
                    if (block && block.name === blockType) {
                        blocks.push(block)
                    }
                }
            }
        }
        
        return blocks
    }

    findNearbyChest(radius) {
        const botPos = this.bot.entity.position.floored()
        
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    const pos = botPos.offset(dx, dy, dz)
                    const block = this.bot.blockAt(pos)
                    
                    if (block && block.name.includes('chest')) {
                        return block
                    }
                }
            }
        }
        
        return null
    }

    // =============================
    // ADDITIONAL COMMAND METHODS
    // =============================
    async placeBlockAt(position, item) {
        if (!item) return false
        
        try {
            await this.bot.equip(item, 'hand')
            const block = this.bot.blockAt(position)
            await this.bot.placeBlock(block, new Vec3(0, 1, 0))
            return true
        } catch (error) {
            this.log(`Failed to place block: ${error.message}`, 'ERROR')
            return false
        }
    }

    async depositToChest(chestBlock, item, amount) {
        try {
            const chest = await this.bot.openContainer(chestBlock)
            await chest.deposit(item.type, null, amount)
            await chest.close()
            return true
        } catch (error) {
            this.log(`Failed to deposit to chest: ${error.message}`, 'ERROR')
            return false
        }
    }

    stopAllActivities() {
        this.stopMovement()
        this.stopAutoCombat()
        
        // Clear all intervals
        Object.values(this.timers).forEach(timer => {
            if (timer && typeof timer === 'object' && timer.clearInterval) {
                clearInterval(timer)
            }
        })
        
        // Reset states
        this.state.isFollowing = false
        this.state.guardMode = false
        this.state.patrolMode = false
        this.state.autoMining = false
        this.state.autoFarming = false
        this.state.autoFishing = false
        this.state.autoBreeding = false
    }

    // =============================
    // PHYSICS TICK HANDLER
    // =============================
    onPhysicsTick() {
        // Guard mode entity scanning
        if (this.state.guardMode && this.state.guardCenter) {
            Object.values(this.bot.entities).forEach(entity => {
                if (!entity.position || !entity.isValid) return
                
                const distance = entity.position.distanceTo(this.state.guardCenter)
                if (distance <= this.state.guardRadius && this.isIntruder(entity)) {
                    this.attackEntity(entity)
                }
            })
        }
        
        // Update distance traveled
        if (this.bot.entity.velocity.length() > 0.1) {
            this.stats.distanceTraveled += this.bot.entity.velocity.length() * 0.05
        }
        
        // Auto-collect nearby items
        if (this.state.autoCollectItems) {
            this.collectNearbyItems()
        }
    }

    isIntruder(entity) {
        if (!entity || !entity.isValid) return false
        
        // Whitelisted players are safe
        if (entity.type === 'player') {
            if (entity.username === this.state.adoptedBy || 
                this.lists.whitelist.has(entity.username)) {
                return false
            }
            
            // Blacklisted players are always intruders
            if (this.lists.blacklist.has(entity.username)) {
                return true
            }
        }
        
        // Handle mobs based on combat mode
        if (entity.type === 'mob') {
            if (this.state.combatMode === 'passive') return false
            if (this.state.combatMode === 'aggressive' && this.lists.hostileMobs.has(entity.name)) return true
            if (this.state.combatMode === 'defensive' && entity.attacker === this.bot.entity) return true
        }
        
        return false
    }

    collectNearbyItems() {
        const items = Object.values(this.bot.entities)
            .filter(e => e.isValid && e.type === 'object' && 
                   e.position.distanceTo(this.bot.entity.position) < 3)
        
        items.forEach(item => {
            // Pathfind to item if not too far
            if (item.position.distanceTo(this.bot.entity.position) > 1) {
                this.bot.pathfinder.setGoal(new GoalNear(
                    item.position.x, 
                    item.position.y, 
                    item.position.z, 
                    1
                ))
            }
        })
    }

    // =============================
    // ADDITIONAL EVENT HANDLERS
    // =============================
    onPlayerCollect(collector, collected) {
        if (collector === this.bot.entity) {
            this.stats.itemsCollected++
        }
    }

    onDeath() {
        this.log('Bot died!', 'WARN')
        this.sendMessage(this.state.adoptedBy, "I died! Respawning...")
        this.stopAllActivities()
    }

    onHealthUpdate() {
        if (this.bot.health < 10) {
            this.sendMessage(this.state.adoptedBy, `Health low: ${this.bot.health}/20`)
        }
    }

    onBreathUpdate() {
        if (this.bot.oxygenLevel < 10 && this.state.autoFishing) {
            this.stopAutoFishing()
            this.sendMessage(this.state.adoptedBy, "Stopped fishing - low oxygen!")
        }
    }

    onSpawnReset() {
        this.log('Spawn point reset', 'INFO')
    }

    onWeatherChange() {
        if (this.bot.isRaining && this.state.autoFishing) {
            this.sendMessage(this.state.adoptedBy, "Great fishing weather!")
        }
    }

    onTimeUpdate() {
        const time = this.bot.time.timeOfDay
        if (time > 13000 && time < 23000 && this.state.combatMode === 'aggressive') {
            // Night time - be more alert
            this.state.guardRadius = Math.min(this.state.guardRadius * 1.5, 32)
        }
    }

    onKicked(reason) {
        this.log(`Kicked from server: ${reason}`, 'ERROR')
    }

    onError(error) {
        this.log(`Bot error: ${error.message}`, 'ERROR')
    }

    onEnd(reason) {
        this.log(`Bot disconnected: ${reason}`, 'INFO')
        this.stopAllActivities()
        
        if (config.autoReconnect) {
            setTimeout(() => this.init(), config.autoReconnectDelay)
        }
    }

    // =============================
    // MORE COMMAND HANDLERS
    // =============================
    commandMode(username, args) {
        if (!this.isOwner(username)) return
        
        const mode = args[0]
        const validModes = ['passive', 'defensive', 'aggressive']
        
        if (validModes.includes(mode)) {
            this.state.combatMode = mode
            this.sendMessage(username, `Combat mode set to: ${mode}`)
        } else {
            this.sendMessage(username, `Valid modes: ${validModes.join(', ')}`)
        }
    }

    commandCPS(username, args) {
        if (!this.isOwner(username)) return
        
        const cps = parseInt(args[0])
        if (cps >= 1 && cps <= 50) {
            this.state.cps = cps
            this.sendMessage(username, `CPS set to ${cps}`)
        } else {
            this.sendMessage(username, 'CPS must be between 1 and 50')
        }
    }

    commandRadius(username, args) {
        if (!this.isOwner(username)) return
        
        const radius = parseInt(args[0])
        if (radius >= 1 && radius <= 64) {
            this.state.guardRadius = radius
            this.sendMessage(username, `Guard radius set to ${radius} blocks`)
        } else {
            this.sendMessage(username, 'Radius must be between 1 and 64')
        }
    }

    commandStatus(username, args) {
        let status = "=== Bot Status ===\n"
        status += `Owner: ${this.state.adoptedBy || 'None'}\n`
        status += `Health: ${this.bot.health}/20 | Food: ${this.bot.food}/20\n`
        status += `Position: ${this.bot.entity.position.floored().toString()}\n`
        status += `Mode: ${this.state.combatMode} | Guard: ${this.state.guardMode ? 'ON' : 'OFF'}\n`
        status += `Following: ${this.state.isFollowing ? 'YES' : 'NO'}\n`
        status += `Patrol: ${this.state.patrolMode ? 'ACTIVE' : 'INACTIVE'}\n`
        status += `Whitelist: ${this.lists.whitelist.size} players\n`
        status += `Blacklist: ${this.lists.blacklist.size} players`
        
        this.sendMessage(username, status)
    }

    commandStats(username, args) {
        let stats = "=== Bot Statistics ===\n"
        for (const [key, value] of Object.entries(this.stats)) {
            stats += `${key.replace(/([A-Z])/g, ' $1').toUpperCase()}: ${value}\n`
        }
        
        this.sendMessage(username, stats)
    }

    commandInventory(username, args) {
        const items = this.bot.inventory.items()
        let inventory = "=== Inventory ===\n"
        
        const groupedItems = {}
        items.forEach(item => {
            if (!groupedItems[item.name]) {
                groupedItems[item.name] = 0
            }
            groupedItems[item.name] += item.count
        })
        
        for (const [itemName, count] of Object.entries(groupedItems)) {
            inventory += `${itemName}: ${count}\n`
        }
        
        inventory += `Total items: ${items.length}`
        this.sendMessage(username, inventory)
    }

    commandEquip(username, args) {
        const itemName = args[0]
        const items = this.bot.inventory.items().filter(item => 
            item.name.includes(itemName) || item.displayName.includes(itemName))
        
        if (items.length > 0) {
            this.bot.equip(items[0], 'hand')
                .then(() => this.sendMessage(username, `Equipped ${items[0].name}`))
                .catch(() => this.sendMessage(username, 'Failed to equip item'))
        } else {
            this.sendMessage(username, `No ${itemName} found in inventory`)
        }
    }

    commandDrop(username, args) {
        const itemName = args[0]
        const amount = parseInt(args[1]) || 64
        
        const items = this.bot.inventory.items().filter(item => 
            item.name.includes(itemName) || item.displayName.includes(itemName))
        
        if (items.length > 0) {
            const toDrop = Math.min(items[0].count, amount)
            this.bot.toss(items[0].type, null, toDrop)
                .then(() => this.sendMessage(username, `Dropped ${toDrop} ${items[0].name}`))
                .catch(() => this.sendMessage(username, 'Failed to drop items'))
        } else {
            this.sendMessage(username, `No ${itemName} found in inventory`)
        }
    }

    commandCoords(username, args) {
        const pos = this.bot.entity.position
        this.sendMessage(username, `X: ${Math.floor(pos.x)} Y: ${Math.floor(pos.y)} Z: ${Math.floor(pos.z)}`)
    }

    commandLook(username, args) {
        const yaw = parseFloat(args[0]) || 0
        const pitch = parseFloat(args[1]) || 0
        
        this.bot.look(yaw * (Math.PI / 180), pitch * (Math.PI / 180))
        this.sendMessage(username, `Looking at yaw: ${yaw}, pitch: ${pitch}`)
    }

    commandJump(username, args) {
        this.bot.setControlState('jump', true)
        setTimeout(() => this.bot.setControlState('jump', false), 500)
        this.sendMessage(username, "Jump!")
    }

    commandDance(username, args) {
        this.sendMessage(username, "💃 Dancing! 🕺")
        
        let danceCount = 0
        const danceInterval = setInterval(() => {
            this.bot.setControlState('jump', true)
            setTimeout(() => this.bot.setControlState('jump', false), 200)
            
            // Rotate while dancing
            this.bot.look(Math.sin(danceCount) * Math.PI, 0)
            
            danceCount++
            if (danceCount >= 10) {
                clearInterval(danceInterval)
            }
        }, 500)
    }

    commandSit(username, args) {
        // Simulate sitting by sneaking
        this.bot.setControlState('sneak', true)
        this.sendMessage(username, "Taking a seat...")
        
        setTimeout(() => {
            this.bot.setControlState('sneak', false)
            this.sendMessage(username, "Standing up!")
        }, 10000) // Sit for 10 seconds
    }

    commandWave(username, args) {
        this.bot.swingArm()
        this.sendMessage(username, "👋 Hello!")
    }

    async commandSleep(username, args) {
        const bed = this.findNearbyBlock(['bed', 'white_bed', 'red_bed'], 5)
        
        if (bed) {
            try {
                await this.bot.sleep(bed)
                this.sendMessage(username, "Good night! 😴")
            } catch (error) {
                this.sendMessage(username, "Can't sleep now!")
            }
        } else {
            this.sendMessage(username, "No bed nearby!")
        }
    }

    commandWake(username, args) {
        if (this.bot.isSleeping) {
            this.bot.wake()
            this.sendMessage(username, "Good morning! ☀️")
        } else {
            this.sendMessage(username, "I'm not sleeping!")
        }
    }

    commandSave(username, args) {
        this.saveData()
        this.sendMessage(username, "Data saved!")
    }

    commandLoad(username, args) {
        this.loadData()
        this.sendMessage(username, "Data loaded!")
    }

    commandLog(username, args) {
        const count = parseInt(args[0]) || 10
        const logs = this.state.activityLog.slice(-count)
        
        let logMessage = `=== Last ${logs.length} Logs ===\n`
        logs.forEach(log => logMessage += log + '\n')
        
        this.sendMessage(username, logMessage)
    }

    commandConfig(username, args) {
        if (!this.isOwner(username)) return
        
        const key = args[0]
        const value = args[1]
        
        if (config.hasOwnProperty(key)) {
            config[key] = isNaN(value) ? value : Number(value)
            this.sendMessage(username, `Config ${key} set to ${value}`)
        } else {
            this.sendMessage(username, `Available configs: ${Object.keys(config).join(', ')}`)
        }
    }

    commandTeleport(username, args) {
        if (!this.isOwner(username)) return
        
        const x = parseFloat(args[0])
        const y = parseFloat(args[1])
        const z = parseFloat(args[2])
        
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            this.moveToPosition(new Vec3(x, y, z))
            this.sendMessage(username, `Teleporting to ${x}, ${y}, ${z}`)
        } else {
            this.sendMessage(username, "Usage: !tp <x> <y> <z>")
        }
    }

    commandWhitelist(username, args) {
        if (!this.isOwner(username) && !this.lists.trustedPlayers.has(username)) return
        
        const subcmd = args[0]
        const player = args[1]
        
        switch (subcmd) {
            case 'add':
                this.lists.whitelist.add(player)
                this.sendMessage(username, `${player} added to whitelist`)
                break
            case 'remove':
                this.lists.whitelist.delete(player)
                this.sendMessage(username, `${player} removed from whitelist`)
                break
            case 'list':
                const list = Array.from(this.lists.whitelist).join(', ')
                this.sendMessage(username, `Whitelist: ${list || 'Empty'}`)
                break
            default:
                this.sendMessage(username, "Usage: !whitelist <add|remove|list> [player]")
        }
        
        this.saveData()
    }

    commandBlacklist(username, args) {
        if (!this.isOwner(username)) return
        
        const subcmd = args[0]
        const player = args[1]
        
        switch (subcmd) {
            case 'add':
                this.lists.blacklist.add(player)
                this.sendMessage(username, `${player} added to blacklist`)
                break
            case 'remove':
                this.lists.blacklist.delete(player)
                this.sendMessage(username, `${player} removed from blacklist`)
                break
            case 'list':
                const list = Array.from(this.lists.blacklist).join(', ')
                this.sendMessage(username, `Blacklist: ${list || 'Empty'}`)
                break
            default:
                this.sendMessage(username, "Usage: !blacklist <add|remove|list> [player]")
        }
        
        this.saveData()
    }

    commandHome(username, args) {
        if (!this.state.homePosition) {
            this.sendMessage(username, "No home set! Use !sethome first")
            return
        }
        
        this.moveToPosition(this.state.homePosition)
        this.sendMessage(username, "Going home!")
    }

    commandSetHome(username, args) {
        if (!this.isOwner(username)) return
        
        this.state.homePosition = this.bot.entity.position.clone()
        this.sendMessage(username, "Home set at current position!")
        this.saveData()
    }

    stopAutoFishing() {
        if (this.timers.fishingInterval) {
            clearInterval(this.timers.fishingInterval)
            this.timers.fishingInterval = null
            this.state.autoFishing = false
        }
    }
}

// =============================
// INITIALIZE BOT
// =============================
const botInstance = new UltimateGuardBot()

// Export for testing/extension
if (typeof module !== 'undefined' && module.exports) {
    module.exports = botInstance
          }
