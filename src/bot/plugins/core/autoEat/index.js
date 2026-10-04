// Adapted from mineflayer-auto-eat 5.0.3; see LICENSE.
const { EventEmitter } = require('events');
const DefaultOpts = {
    eatingTimeout: 3000,
    minHealth: 14,
    minHunger: 15,
    returnToLastItem: true,
    offhand: false,
    priority: 'foodPoints',
    bannedFood: ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye'],
    strictErrors: true
};
class EatUtil extends EventEmitter {
    bot;
    opts;
    _eating = false;
    _enabled = false;
    _rejectionBinding;
    get foods() {
        return this.bot.registry.foods;
    }
    get foodsArray() {
        return this.bot.registry.foodsArray;
    }
    get foodsByName() {
        return this.bot.registry.foodsByName;
    }
    get isEating() {
        return this._eating;
    }
    get enabled() {
        return this._enabled;
    }
    constructor(bot, opts = {}) {
        super();
        this.bot = bot;
        this.opts = Object.assign({}, DefaultOpts, opts);
    }
    getAllItems() {
        const items = this.bot.inventory.items();
        if (!this.bot.supportFeature('doesntHaveOffHandSlot')) {
            const offhand = this.bot.inventory.slots[this.bot.getEquipmentDestSlot('off-hand')];
            if (offhand && !items.includes(offhand)) items.push(offhand);
        }
        return items;
    }
    async equip(item, hand) {
        try {
            await this.bot.equip(item, hand);
            return true;
        } catch {
            return false;
        }
    }
    setOpts(opts) {
        Object.assign(this.opts, opts);
    }
    cancelEat() {
        if (this._rejectionBinding == null)
            return;
        this._rejectionBinding(new Error('Eating manually canceled!'));
        this.bot.deactivateItem();
    }
    /**
     * Given a list of items, determine which food is optimal.
     * @param items
     * @returns Optimal item.
     */
    findBestChoices(items, priority) {
        return items
            .filter((i) => i.name in this.foodsByName)
            .filter((i) => {
            if (i.name === 'fish' && i.metadata === 3)
                return false; // 1.8 fix
            return !this.opts.bannedFood.includes(i.name);
        })
            .sort((a, b) => this.foodsByName[b.name][priority] - this.foodsByName[a.name][priority]);
    }
    /**
     * Handle different typings of a food selection.
     * Used in {@link sanitizeOpts}.
     * @param sel A variety of types that refer to a wanted food item.
     * @returns The wanted item in bot's inventory, or nothing.
     */
    normalizeFoodChoice(sel) {
        if (sel == null)
            return undefined;
        else if (typeof sel === 'string')
            return this.getAllItems().find((i) => i.name === sel);
        else if (typeof sel === 'number')
            return this.getAllItems().find((i) => i.type === sel);
        else if (typeof sel === 'object' && 'name' in sel && 'type' in sel)
            return sel;
        const fsel = sel;
        return this.getAllItems().find((i) => i.type === fsel.id);
    }
    /**
     * Sanitize options provided to eat function,
     * normalizing them to plugin options.
     * @param opts
     * @returns {boolean} whether opts is correctly sanitized.
     */
    sanitizeOpts(opts) {
        opts.equipOldItem =
            opts.equipOldItem === undefined ? this.opts.returnToLastItem : opts.equipOldItem;
        opts.offhand = opts.offhand === undefined ? this.opts.offhand : opts.offhand;
        opts.priority = opts.priority === undefined ? this.opts.priority : opts.priority;
        let choice = this.normalizeFoodChoice(opts.food);
        if (choice != null)
            opts.food = choice;
        else {
            const allItems = this.getAllItems();
            const choices = this.findBestChoices(allItems, opts.priority);
            if (choices.length == 0)
                return false;
            opts.food = choices[0];
        }
        return true;
    }
    /**
     * Utility function to handle potential changes in inventory and eating status.
     * Immediately handles events on a subscriber basis instead of polling.
     * @param relevantItem
     * @param timeout
     * @returns
     */
    buildEatingListener(relevantItem, timeout) {
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timer);
                this.bot._client.off('entity_status', eatingListener);
                this.bot.inventory.off('updateSlot', itemListener);
                delete this._rejectionBinding;
            };
            const fail = (error) => {
                cleanup();
                reject(error);
            };
            const eatingListener = (packet) => {
                if (packet.entityId === this.bot.entity.id && packet.entityStatus === 9) {
                    cleanup();
                    resolve();
                }
            };
            const itemListener = (slot, oldItem, newItem) => {
                if (oldItem?.slot === relevantItem.slot && newItem?.type !== relevantItem.type) {
                    fail(new Error(`Item switched early to: ${newItem?.name}!`));
                }
            };
            const timer = setTimeout(() => {
                fail(new Error(`Eating timed out with a time of ${timeout} milliseconds!`));
            }, timeout);
            this.bot._client.on('entity_status', eatingListener);
            this.bot.inventory.on('updateSlot', itemListener);
            this._rejectionBinding = fail;
        });
    }
    /**
     * Call this to eat an item.
     * @param opts
     */
    async eat(opts = {}) {
        // if we are already eating, throw error.
        if (this._eating)
            throw new Error('Already eating!');
        this._eating = true;
        // Sanitize options; if not valid, throw error.
        if (!this.sanitizeOpts(opts)) {
            this._eating = false;
            throw new Error("No food specified and couldn't find a choice in inventory!");
        }
        // get current item in hand + wanted hand
        const currentItem = this.bot.inventory.slots[this.bot.getEquipmentDestSlot(opts.offhand ? "off-hand" : "hand")];
        const switchedItems = currentItem != opts.food;
        const wantedHand = opts.offhand ? "off-hand" : "hand";
        // if not already holding item, equip item
        if (switchedItems) {
            const equipped = await this.equip(opts.food, wantedHand);
            // if fail to equip, throw error.
            if (!equipped) {
                this._eating = false;
                throw new Error(`Failed to equip: ${opts.food.name}!\nItem: ${opts.food}`);
            }
        }
        // ! begin eating item
        // sanitize by deactivating beforehand
        this.bot.deactivateItem();
        // trigger use state based on hand
        this.bot.activateItem(opts.offhand);
        this.emit('eatStart', opts);
        // Wait for eating to finish, handle errors gracefully if there are, and perform cleanup.
        try {
            await this.buildEatingListener(opts.food, this.opts.eatingTimeout);
        }
        catch (error) {
            this.emit('eatFail', error);
            if (this.opts.strictErrors)
                throw error; // expose error to outer environment
            else
                console.error(error);
        }
        finally {
            if (opts.equipOldItem && switchedItems && currentItem)
                await this.equip(currentItem, wantedHand);
            delete this._rejectionBinding;
            this._eating = false;
            this.emit('eatFinish', opts);
        }
    }
    statusCheck = async () => {
        if ((this.bot.food < this.opts.minHunger || this.bot.health < this.opts.minHealth) &&
            !this._eating) {
            try {
                await this.eat();
            }
            catch { }
        }
    };
    enableAuto() {
        if (this._enabled)
            return;
        this._enabled = true;
        this.bot.on('physicsTick', this.statusCheck);
    }
    disableAuto() {
        if (!this._enabled)
            return;
        this._enabled = false;
        this.bot.off('physicsTick', this.statusCheck);
    }
}

function loader(bot) {
    bot.autoEat = new EatUtil(bot);
}

module.exports = { loader, EatUtil };
