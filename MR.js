const { ipcRenderer, app } = require('electron');
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const GoalFollow = goals.GoalFollow
var tpsPlugin = require('mineflayer-tps')(mineflayer)
const mineflayerViewer = require('prismarine-viewer').mineflayer
const inventoryViewer = require('mineflayer-web-inventory')
var radarPlugin = require('mineflayer-radar')(mineflayer);
const pvp = require('mineflayer-pvp').plugin
const armorManager = require('mineflayer-armor-manager')
const autoeat = require("mineflayer-auto-eat")
const toolPlugin = require('mineflayer-tool').plugin
const antiafk = require('./antiafk')
const vec3 = require("vec3")
const Store = require('electron-store');
const store = new Store();



document.getElementById('close-btn').addEventListener('click', () => {
    ipcRenderer.send('close-app');
});
document.getElementById('mmin-btn').addEventListener('click', () => {
    ipcRenderer.send('mmin-app');
});

i = 0
document.getElementById('Btnlol').addEventListener('click', () => {
    i++
    if (i == 10) {
        ipcRenderer.send('Wctcn');
        i = 0
    }
});
const updateOnlineStatus = () => {
    document.getElementById('noE').style.display = "none";
}
const updateOfflineStatus = () => {
    document.getElementById('noE').style.display = "block";
}
window.addEventListener('online', updateOnlineStatus)
window.addEventListener('offline', updateOfflineStatus)
document.getElementById('sck-btn').addEventListener('click', (event, data) => {
    var sip = document.getElementById('SIP').value;
    var sp = document.getElementById('SP').value;
    spo = sp || 25565
    axios.get('https://mcapi.us/server/status?ip=' + sip + '&port=' + spo)
        .then(function (response) {
            document.getElementById('result').innerHTML = `${response.data.status}`
            if (response.data.status == "error") {
                document.getElementById('result').style.color = "red";
            } else {
                document.getElementById('result').style.color = "green";
            }
            document.getElementById('status').innerHTML = `${response.data.online}`
            document.getElementById('err').innerHTML = `${response.data.error}`
            document.getElementById('prot').innerHTML = `${response.data.server.protocol}`
            document.getElementById('nv').innerHTML = `${response.data.server.name}`
            document.getElementById('motd').innerHTML = `${response.data.motd || response.data.motd_json}`
            document.getElementById('mp').innerHTML = `${response.data.players.max}`
            document.getElementById('op').innerHTML = `${response.data.players.now}`
            document.getElementById('seric').style.backgroundImage = `url(${response.data.favicon})`
        })
});

//bot
document.getElementById('host').value = store.get('BotData.host');
document.getElementById('port').value = store.get('BotData.port');
document.getElementById('username').value = store.get('BotData.username');
document.getElementById('password').value = store.get('BotData.password');

document.getElementById('connect').addEventListener('click', () => {
    const data = {
        host: document.getElementById('host').value,
        port: document.getElementById('port').value,
        username: document.getElementById('username').value,
        version: document.getElementById('version').value,
        auth: document.getElementById('authtype').value,
        password: document.getElementById('password').value,
    }
    if (data.version == 'default') {
        data.version = ''
    }
    if (data.auth == 'default') {
        data.auth = ''
    }
    store.set('BotData', data)
    newBot(data)
});
function newBot(data) {
    const bot = mineflayer.createBot({
        host: data.host,
        port: data.port || 255652,
        username: data.username,
        password: data.password,
        auth: data.auth,
        version: data.version,
    })
    bot.loadPlugin(tpsPlugin);
    bot.loadPlugin(autoeat);
    bot.autoEat.disable()
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(pvp);
    bot.loadPlugin(antiafk);
    bot.loadPlugin(armorManager);
    bot.loadPlugin(toolPlugin)



    document.getElementById('disconnect').addEventListener('click', () => {
        bot.quit()
        document.getElementById('blur').style.display = "display";
    });
    
    bot.on('login', function () {
    });
    bot.on('health', () => {
        document.getElementById('healthhp').innerHTML = `${bot.health.toFixed()}`
        document.getElementById('foodhp').innerHTML = `${bot.food.toFixed()}`

    })
    bot.on('physicTick', () => {
        document.getElementById('bot-z').innerHTML = Math.floor(bot.entity.position.z);
        document.getElementById('bot-y').innerHTML = Math.floor(bot.entity.position.y);
        document.getElementById('bot-x').innerHTML = Math.floor(bot.entity.position.x);
        document.getElementById('servertps').innerHTML = bot.getTps();
        document.getElementById('botping').innerHTML = bot.players[data.username].ping;
        document.getElementById('playersOnline').innerHTML = Object.keys(bot.players).length;
    })
    bot.once('spawn', () => {
        mineflayerViewer(bot, { port: 3009, firstPerson: true })
        let options = {
            port: 3001,
        }
        inventoryViewer(bot, options)
        var Roptions = {
            port: 3002,
        }
        radarPlugin(bot, Roptions);
    });

    document.getElementById('viewer').addEventListener('click', () => {
        ipcRenderer.send('viewer');
    });
    document.getElementById('inventory').addEventListener('click', () => {
        ipcRenderer.send('inventory');
    });
    document.getElementById('radar').addEventListener('click', () => {
        ipcRenderer.send('radar');
    });
    document.getElementById('control').addEventListener('click', () => {
        ipcRenderer.send('control');
    });
    document.getElementById('go').addEventListener('click', () => {
        x = (document.getElementById('go-x').value)
        y = (document.getElementById('go-y').value)
        z = (document.getElementById('go-z').value)
        const RANGE_GOAL = 1
        const mcData = require('minecraft-data')(bot.version)
        const defaultMove = new Movements(bot, mcData)
        bot.pathfinder.setMovements(defaultMove)
        bot.pathfinder.setGoal(new GoalNear(x, y, z, RANGE_GOAL))
    })

    document.getElementById('walk').addEventListener('change', () => {
        if (document.getElementById("walk").checked == true) {
            bot.setControlState('forward', true)
        } else {
            bot.setControlState('forward', false)
        }
    });
    document.getElementById('run').addEventListener('change', () => {
        if (document.getElementById("run").checked == true) {
            bot.setControlState('sprint', true)

        } else {
            bot.setControlState('sprint', false)
        }
    });
    document.getElementById('toggle-jump').addEventListener('change', () => {
        if (document.getElementById("toggle-jump").checked == true) {
            bot.setControlState('jump', true)
        } else {
            bot.setControlState('jump', false)
        }
    });
    document.getElementById('lookatnear').addEventListener('change', () => {
        if (document.getElementById("lookatnear").checked == true) {
            function lookAtNearestPlayer() {
                if (document.getElementById("lookatnear").checked == false) {
                    return;
                }
                const playerEntity = bot.nearestEntity()
                if (!playerEntity) return
                const pos = playerEntity.position.offset(0, playerEntity.height, 0)
                bot.lookAt(pos)
            }
            bot.on('physicTick', lookAtNearestPlayer)
        }
    });
    document.getElementById('jump').addEventListener('click', () => {
        bot.setControlState('jump', true)
        bot.setControlState('jump', false)
    });
    document.getElementById('West').addEventListener('click', () => {
        bot.look(1.5, 0)
    });
    document.getElementById('East').addEventListener('click', () => {
        bot.look(-1.5, 0)
    });
    document.getElementById('South').addEventListener('click', () => {
        bot.look(3, 0)
    });
    document.getElementById('North').addEventListener('click', () => {
        bot.look(0, 0)
    });
    document.getElementById('FollowplayerToggle').addEventListener('change', () => {
        if (document.getElementById("FollowplayerToggle").checked == true) {
            if (document.getElementById("FollowplayerToggle").checked == false) {
                return;
            }
            var followplayer = document.getElementById('Followplayerselect').value
            if (followplayer == 'default') {
                return
            }
            const playerNF = bot.players[followplayer]
            if (!playerNF || !playerNF.entity) {
                //bot.chat("I can't see CI!")
                return
            }
            const mcData = require('minecraft-data')(bot.version)
            const movements = new Movements(bot, mcData)
            bot.pathfinder.setMovements(movements)
            const goal = new GoalFollow(playerNF.entity, 1)
            bot.pathfinder.setGoal(goal, true)
        } else {
            bot.pathfinder.setGoal()
        }
    });
    document.getElementById('Followplayer').addEventListener('click', () => {
        var followplayer = document.getElementById('Followplayerselect').value
        if (followplayer == 'default') {
            return
        }
        const playerNF = bot.players[followplayer]
        if (!playerNF || !playerNF.entity) {
            //bot.chat("I can't see CI!")
            return
        }
        const mcData = require('minecraft-data')(bot.version)
        const movements = new Movements(bot, mcData)
        bot.pathfinder.setMovements(movements)
        const goal = new GoalFollow(playerNF.entity, 1)
        bot.pathfinder.setGoal(goal)
    });
    document.getElementById('Followplayerselect').addEventListener('change', () => {
        if (document.getElementById("FollowplayerToggle").checked == true) {
            document.getElementById("FollowplayerToggle").click();
        }
    })
    document.getElementById('Fight-pToggle').addEventListener('change', () => {
        if (document.getElementById("Fight-pToggle").checked == true) {
            var FightP = document.getElementById('Fight-p').value
            if (FightP == 'default') {
                return
            }
            const player = bot.players[FightP]
            if (!player) {
                //bot.chat("I can't see you.")
                return
            }
            bot.pvp.attack(player.entity)
        } else {
            bot.pvp.stop()
        }

        bot.on('stoppedAttacking', () => {
            if (document.getElementById("Fight-pToggle").checked == true) {
                document.getElementById("Fight-pToggle").click();
            }
        })
    });


    let guardPos = null

    function guardArea(pos) {
        guardPos = pos
        if (!bot.pvp.target) {
            moveToGuardPos()
        }
    }

    function stopGuarding() {
        guardPos = null
        bot.pvp.stop()
        bot.pathfinder.setGoal(null)
    }

    function moveToGuardPos() {
        const mcData = require('minecraft-data')(bot.version)
        bot.pathfinder.setMovements(new Movements(bot, mcData))
        bot.pathfinder.setGoal(new goals.GoalBlock(guardPos.x, guardPos.y, guardPos.z))
    }

    bot.on('stoppedAttacking', () => {
        if (guardPos) {
            moveToGuardPos()
        }
    })

    bot.on('physicTick', () => {
        if (bot.pvp.target) return
        if (bot.pathfinder.isMoving()) return

        const entity = bot.nearestEntity()
    })

    bot.on('physicTick', () => {
        if (!guardPos) return

        const filter = e => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 16 &&
            e.mobType !== 'Armor Stand' // Mojang classifies armor stands as mobs for some reason?

        const entity = bot.nearestEntity(filter)
        if (entity) {
            bot.pvp.attack(entity)
        }
    })
    document.getElementById('GuardToggle').addEventListener('change', () => {
        if (document.getElementById("GuardToggle").checked == true) {
            var GuardHere = vec3(document.getElementById('Guard_x').value, document.getElementById('Guard_y').value, document.getElementById('Guard_z').value);
            guardArea(GuardHere)
        }
        if (document.getElementById("GuardToggle").checked == false) {
            stopGuarding()
        }
    });
    document.getElementById('FightNearEntityToggle').addEventListener('change', () => {
        if (document.getElementById("FightNearEntityToggle").checked == true) {
            bot.on('physicTick', () => {
                const filter = e => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 16 &&
                    e.mobType !== 'Armor Stand'

                const entity = bot.nearestEntity(filter)
                if (entity) {
                    bot.pvp.attack(entity)
                }
            })
        }
        if (document.getElementById("FightNearEntityToggle").checked == false) {
            bot.pvp.stop()
        }
    });
    function togglAllOff() {
        const checkboxIds = ['FightNearEntityToggle', 'GuardToggle', 'Fight-pToggle', 'FollowplayerToggle', 'toggle-jump']
        checkboxIds.forEach(id => {
            if (document.getElementById(id).checked == true) {
                document.getElementById(id).click();
            }
        });
    }
    bot.on('end', () => {
        if (document.getElementById("AutoReconectToggle").checked == true) {
            newBot(data)
        };
        togglAllOff()
    });
    document.getElementById('StopAll').addEventListener('click', () => {
        togglAllOff()
    });
    document.getElementById('afkToggle').addEventListener('change', () => {
        if (document.getElementById("afkToggle").checked == true) {
            bot.afk.start();
        } else {
            bot.afk.stop();
        }
    });
    document.getElementById('totemtoggle').addEventListener('change', () => {
        if (document.getElementById("totemtoggle").checked == true) {
            function autototemtoggle() {
                if (document.getElementById("totemtoggle").checked == false) {
                    return;
                }
                if (bot.inventory.slots[45] != null) return
                const totem = bot.inventory.findInventoryItem('totem_of_undying', null, null)
                const shild = bot.inventory.findInventoryItem('shield', null, null)
                if (totem) {
                    bot.inventory.requiresConfirmation = false
                    bot.equip(totem, 'off-hand')
                }
            }
            bot.on('physicTick', autototemtoggle)
        }
    });
    goshild = true
    function setshild() {
        document.getElementById('ShildorTotem').style.backgroundImage = `url(./images/Shild.png)`
    }
    function settotem() {
        document.getElementById('ShildorTotem').style.backgroundImage = `url(./images/totem.webp)`
    }
    setshild()
    document.getElementById('ShildorTotem').addEventListener('click', () => {
        if (goshild == true) {
            settotem()
            goshild = false
        } else {
            setshild()
            goshild = true
        }
    });
    //its lil messy up there
    //but its works ey?
    //make it acsually change the off hand
    //see yaaaaa

    bot.on('spawn', () => {
        document.getElementById('blur').style.display = "none";
    })
    bot.on('kicked', (reason) => {
        document.getElementById('blur').style.display = "display";
        alert(reason)
    })
    bot.on('end', (reason) => {
        document.getElementById('blur').style.display = "display";
        alert(reason)
    })
    // fix it so no dubleeee


    bot.on('autoeat_started', (item, offhand) => {
        console.log(`Eating ${item.name} in ${offhand ? 'offhand' : 'hand'}`)
    })

    bot.on('autoeat_error', (error) => {
        console.log(error)
    })

    bot.on('autoeat_finished', (item, offhand) => {
        console.log(`Finished eating ${item.name} in ${offhand ? 'offhand' : 'hand'}`)
    })
    document.getElementById('eatToggle').addEventListener('change', () => {
        if (document.getElementById("eatToggle").checked == true) {
            bot.autoEat.enable()
        } else {
            bot.autoEat.disable()
        }
    });
    document.getElementById('ArmorToggle').addEventListener('change', () => {
        if (document.getElementById("ArmorToggle").checked == true) {
            document.getElementById("ArmorToggle").click();
        }
    });

};


document.getElementById('up-x').addEventListener('change', () => {
    document.getElementById('down-x').innerHTML = document.getElementById('up-x').value
});
