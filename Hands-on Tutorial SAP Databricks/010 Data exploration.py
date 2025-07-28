# Databricks notebook source
# MAGIC %md
# MAGIC ![](/Workspace/Users/ge205182@sapexperienceacademy.com/Demand forecast/Images/Step 1 - Data exploration.png)

# COMMAND ----------

# MAGIC %md
# MAGIC # Data exploration
# MAGIC Become familiar with the data

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT
# MAGIC   COUNTRYOFRESIDENCE,
# MAGIC   SUM(OVERNIGHTSTAYS) AS total_overnightstays
# MAGIC FROM
# MAGIC   workspace.default.overnightstays
# MAGIC GROUP BY
# MAGIC   COUNTRYOFRESIDENCE
# MAGIC ORDER BY
# MAGIC   total_overnightstays DESC

# COMMAND ----------

# MAGIC %md
# MAGIC Load data into PySpark DataFrame

# COMMAND ----------

overnightstays_sdf = spark.read.table("workspace.default.overnightstays") 

# COMMAND ----------

# MAGIC %md
# MAGIC Aggregate by month

# COMMAND ----------

import pyspark.sql.functions as F
display(overnightstays_sdf.groupBy("month").agg(F.sum("overnightstays").alias("overnightstays")))

# COMMAND ----------

import pyspark.sql.functions as F
import plotly.express as px

overnightstays_with_year = overnightstays_sdf.withColumn("year", F.year("month"))
yearly_agg = overnightstays_with_year.groupBy("year").agg(F.sum("overnightstays").alias("overnightstays"))

yearly_pd = yearly_agg.orderBy("year").toPandas()
fig = px.bar(yearly_pd, x="year", y="overnightstays", title="Overnight Stays by Year")
fig.show()