import React from "react"

export default ({ pageContext: { dog } }) => (
  <section role="datepicker">
    {dog.name} - {dog.breed}
  </section>
)
