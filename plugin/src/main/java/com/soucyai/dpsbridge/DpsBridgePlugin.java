/*
 * Copyright (c) 2026, soucyai
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
package com.soucyai.dpsbridge;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.inject.Inject;
import lombok.extern.slf4j.Slf4j;
import net.runelite.api.Actor;
import net.runelite.api.Client;
import net.runelite.api.EnumComposition;
import net.runelite.api.EnumID;
import net.runelite.api.EquipmentInventorySlot;
import net.runelite.api.GameState;
import net.runelite.api.Item;
import net.runelite.api.ItemContainer;
import net.runelite.api.NPC;
import net.runelite.api.ParamID;
import net.runelite.api.Player;
import net.runelite.api.Prayer;
import net.runelite.api.Skill;
import net.runelite.api.StructComposition;
import net.runelite.api.events.GameStateChanged;
import net.runelite.api.events.GameTick;
import net.runelite.api.gameval.InventoryID;
import net.runelite.api.gameval.VarPlayerID;
import net.runelite.api.gameval.VarbitID;
import net.runelite.client.eventbus.Subscribe;
import net.runelite.client.plugins.Plugin;
import net.runelite.client.plugins.PluginDescriptor;
import net.runelite.client.util.Filepath;

/**
 * Writes the player's combat state to ~/.runelite/plugin-data/dps_bridge/state.json so a local
 * MCP server can run DPS calculations on it. Read-only: never sends input to the game.
 */
@Slf4j
@PluginDescriptor(
	name = "DPS Bridge",
	internalName = "dps_bridge",
	description = "Exports gear, boosted levels, prayers, attack style and target for an external DPS calculator",
	tags = {"dps", "calculator", "mcp", "combat"}
)
public class DpsBridgePlugin extends Plugin
{
	@Inject
	private Client client;

	@Inject
	private Gson gson;

	private ExecutorService writer;
	private Filepath dir;
	private String lastJson;
	private JsonObject lastTarget;

	@Override
	protected void startUp() throws Exception
	{
		// All file I/O goes through Filepath (Plugin Hub rule): .runelite/plugin-data/dps_bridge/
		dir = getPluginDirectory();
		writer = Executors.newSingleThreadExecutor(r ->
		{
			Thread t = new Thread(r, "dps-bridge-writer");
			t.setDaemon(true);
			return t;
		});
	}

	@Override
	protected void shutDown()
	{
		writeLoggedOut();
		writer.shutdown();
		lastJson = null;
		lastTarget = null;
	}

	@Subscribe
	public void onGameStateChanged(GameStateChanged e)
	{
		if (e.getGameState() == GameState.LOGIN_SCREEN)
		{
			lastTarget = null;
			writeLoggedOut();
		}
	}

	@Subscribe
	public void onGameTick(GameTick e)
	{
		Player me = client.getLocalPlayer();
		if (me == null)
		{
			return;
		}

		JsonObject j = new JsonObject();
		j.addProperty("version", 1);
		j.addProperty("loggedIn", true);
		j.addProperty("playerName", me.getName());
		j.add("equipment", equipment());
		j.add("realLevels", levels(false));
		j.add("boostedLevels", levels(true));
		j.add("prayers", prayers());
		addStyle(j);
		j.add("buffs", buffs());

		Actor target = me.getInteracting();
		if (target instanceof NPC)
		{
			NPC npc = (NPC) target;
			JsonObject t = new JsonObject();
			t.addProperty("id", npc.getId());
			t.addProperty("name", npc.getName());
			lastTarget = t; // remembered after the kill so you can still ask about it
		}
		j.add("target", lastTarget);

		String json = gson.toJson(j);
		if (json.equals(lastJson))
		{
			return; // only touch the disk when something changed
		}
		lastJson = json;

		JsonObject withTime = j.deepCopy();
		withTime.addProperty("timestamp", System.currentTimeMillis());
		write(gson.toJson(withTime));
	}

	private JsonObject equipment()
	{
		ItemContainer worn = client.getItemContainer(InventoryID.WORN);
		JsonObject eq = new JsonObject();
		slot(eq, worn, "head", EquipmentInventorySlot.HEAD);
		slot(eq, worn, "cape", EquipmentInventorySlot.CAPE);
		slot(eq, worn, "neck", EquipmentInventorySlot.AMULET);
		slot(eq, worn, "weapon", EquipmentInventorySlot.WEAPON);
		slot(eq, worn, "body", EquipmentInventorySlot.BODY);
		slot(eq, worn, "shield", EquipmentInventorySlot.SHIELD);
		slot(eq, worn, "legs", EquipmentInventorySlot.LEGS);
		slot(eq, worn, "hands", EquipmentInventorySlot.GLOVES);
		slot(eq, worn, "feet", EquipmentInventorySlot.BOOTS);
		slot(eq, worn, "ring", EquipmentInventorySlot.RING);
		slot(eq, worn, "ammo", EquipmentInventorySlot.AMMO);
		return eq;
	}

	private static void slot(JsonObject eq, ItemContainer worn, String key, EquipmentInventorySlot s)
	{
		Item item = worn == null ? null : worn.getItem(s.getSlotIdx());
		if (item == null || item.getId() <= 0)
		{
			eq.add(key, null);
		}
		else
		{
			eq.addProperty(key, item.getId());
		}
	}

	private JsonObject levels(boolean boosted)
	{
		JsonObject o = new JsonObject();
		lvl(o, "atk", Skill.ATTACK, boosted);
		lvl(o, "str", Skill.STRENGTH, boosted);
		lvl(o, "def", Skill.DEFENCE, boosted);
		lvl(o, "ranged", Skill.RANGED, boosted);
		lvl(o, "magic", Skill.MAGIC, boosted);
		lvl(o, "prayer", Skill.PRAYER, boosted);
		lvl(o, "hp", Skill.HITPOINTS, boosted);
		lvl(o, "mining", Skill.MINING, boosted);
		lvl(o, "herblore", Skill.HERBLORE, boosted);
		lvl(o, "farming", Skill.FARMING, boosted);
		return o;
	}

	private void lvl(JsonObject o, String key, Skill skill, boolean boosted)
	{
		o.addProperty(key, boosted ? client.getBoostedSkillLevel(skill) : client.getRealSkillLevel(skill));
	}

	private JsonArray prayers()
	{
		JsonArray a = new JsonArray();
		for (Prayer p : Prayer.values())
		{
			try
			{
				if (client.isPrayerActive(p))
				{
					a.add(p.name());
				}
			}
			catch (Exception ignored)
			{
				// prayers without a varbit in the current game mode
			}
		}
		return a;
	}

	private void addStyle(JsonObject j)
	{
		j.addProperty("attackStyleIndex", client.getVarpValue(VarPlayerID.COM_MODE));
		j.addProperty("castingMode", client.getVarbitValue(VarbitID.AUTOCAST_DEFMODE));
		int category = client.getVarbitValue(VarbitID.COMBAT_WEAPON_CATEGORY);
		j.addProperty("weaponCategory", category);

		try
		{
			EnumComposition styles = client.getEnum(EnumID.WEAPON_STYLES);
			int[] structs = client.getEnum(styles.getIntValue(category)).getIntVals();
			JsonArray slots = new JsonArray();
			for (int id : structs)
			{
				StructComposition s = client.getStructComposition(id);
				slots.add(s.getStringValue(ParamID.ATTACK_STYLE_NAME));
			}
			j.add("styleSlots", slots);
		}
		catch (Exception ex)
		{
			log.debug("Could not read weapon style structs", ex);
		}
	}

	private JsonObject buffs()
	{
		JsonObject b = new JsonObject();
		b.addProperty("onSlayerTask", client.getVarpValue(VarPlayerID.SLAYER_COUNT) > 0);
		b.addProperty("inWilderness", client.getVarbitValue(VarbitID.INSIDE_WILDERNESS) == 1);
		b.addProperty("kandarinDiary", client.getVarbitValue(VarbitID.KANDARIN_DIARY_HARD_COMPLETE) == 1);
		b.addProperty("chargeSpell", client.getVarpValue(VarPlayerID.MAGEARENA_CHARGE) > 0);
		return b;
	}

	private void writeLoggedOut()
	{
		lastJson = null;
		JsonObject j = new JsonObject();
		j.addProperty("version", 1);
		j.addProperty("loggedIn", false);
		j.addProperty("timestamp", System.currentTimeMillis());
		write(gson.toJson(j));
	}

	private void write(String json)
	{
		if (writer == null || writer.isShutdown())
		{
			return;
		}
		writer.submit(() ->
		{
			try
			{
				dir.createDirectories();
				Filepath tmp = dir.join("state.json.tmp");
				Filepath file = dir.join("state.json");
				tmp.write(json.getBytes(StandardCharsets.UTF_8));
				try
				{
					tmp.moveTo(file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
				}
				catch (AtomicMoveNotSupportedException ex)
				{
					tmp.moveTo(file, StandardCopyOption.REPLACE_EXISTING);
				}
			}
			catch (IOException ex)
			{
				log.warn("DPS Bridge could not write {}", dir, ex);
			}
		});
	}
}
